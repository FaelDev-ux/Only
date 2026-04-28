import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

export class InventoryError extends Error {
  constructor(message, productTitle = "") {
    super(message);
    this.name = "InventoryError";
    this.productTitle = productTitle;
  }
}

export function normalizeStockNumber(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}

export function productTracksStock(product) {
  return product?.trackStock === true;
}

export function getProductStock(product) {
  return normalizeStockNumber(product?.stock, 0);
}

export function productHasStock(product, requestedQty = 1) {
  if (!productTracksStock(product)) return true;
  return getProductStock(product) >= requestedQty;
}

export function getProductStockText(product) {
  if (!productTracksStock(product)) return "Estoque livre";

  const stock = getProductStock(product);
  if (stock <= 0) return "Sem estoque";

  const minStock = normalizeStockNumber(product?.minStock, 0);
  if (minStock > 0 && stock <= minStock) return `${stock} em estoque - baixo`;

  return `${stock} em estoque`;
}

export function isActiveStockItem(item) {
  return !item?.status || item.status === "active";
}

export function makeLineId(prefix = "item") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeLineItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    lineId: item?.lineId || makeLineId(`item-${index}`),
    status: item?.status || "active",
  }));
}

function buildProductDeltas(beforeItems, afterItems) {
  const deltas = new Map();

  function addQty(item, sign) {
    if (!item?.productId) return;
    if (!isActiveStockItem(item)) return;

    const qty = normalizeStockNumber(item.qty, 0);
    if (qty <= 0) return;

    const current = deltas.get(item.productId) || {
      productId: item.productId,
      productTitle: item.productTitle || item.title || "Produto",
      beforeQty: 0,
      afterQty: 0,
    };

    if (sign < 0) current.beforeQty += qty;
    else current.afterQty += qty;

    deltas.set(item.productId, current);
  }

  beforeItems.forEach((item) => addQty(item, -1));
  afterItems.forEach((item) => addQty(item, 1));

  return Array.from(deltas.values())
    .map((entry) => ({
      ...entry,
      stockDelta: entry.beforeQty - entry.afterQty,
    }))
    .filter((entry) => entry.stockDelta !== 0);
}

function buildMovement({
  actor = {},
  entry,
  reason,
  source,
  sourceId,
  sourceCode,
}) {
  return {
    productId: entry.productId,
    productTitle: entry.productTitle,
    qty: Math.abs(entry.stockDelta),
    delta: entry.stockDelta,
    type: entry.stockDelta > 0 ? "entrada" : "saida",
    reason,
    source,
    sourceId,
    sourceCode: sourceCode || "",
    actorName: actor.name || "",
    actorEmail: actor.email || "",
    createdAt: serverTimestamp(),
  };
}

async function applyStockDeltas(transaction, db, deltas, movementContext) {
  const productSnapshots = [];

  for (const entry of deltas) {
    const productRef = doc(db, "products", entry.productId);
    const snapshot = await transaction.get(productRef);
    productSnapshots.push({ entry, productRef, snapshot });
  }

  for (const { entry, productRef, snapshot } of productSnapshots) {
    if (!snapshot.exists()) {
      throw new InventoryError("Produto nao encontrado no estoque.", entry.productTitle);
    }

    const product = snapshot.data();
    if (!productTracksStock(product)) continue;

    const currentStock = getProductStock(product);
    const nextStock = currentStock + entry.stockDelta;

    if (nextStock < 0) {
      throw new InventoryError(
        `${product.title || entry.productTitle} nao tem estoque suficiente.`,
        product.title || entry.productTitle
      );
    }

    transaction.update(productRef, {
      stock: increment(entry.stockDelta),
    });

    const movementRef = doc(collection(db, "stockMovements"));
    transaction.set(
      movementRef,
      buildMovement({
        ...movementContext,
        entry: {
          ...entry,
          productTitle: product.title || entry.productTitle,
        },
      })
    );
  }
}

export async function createRecordWithStock({
  db,
  recordRef,
  recordData,
  items,
  source,
  sourceCode,
  actor,
}) {
  const normalizedItems = normalizeLineItems(items);
  const stockDeltas = buildProductDeltas([], normalizedItems);

  await runTransaction(db, async (transaction) => {
    await applyStockDeltas(transaction, db, stockDeltas, {
      reason: "venda",
      source,
      sourceId: recordRef.id,
      sourceCode,
      actor,
    });

    transaction.set(recordRef, {
      ...recordData,
      items: normalizedItems,
    });
  });

  return normalizedItems;
}

export async function updateRecordItemsWithStock({
  db,
  recordRef,
  previousItems,
  nextItems,
  recordPatch,
  reason,
  source,
  sourceCode,
  actor,
}) {
  const normalizedPreviousItems = normalizeLineItems(previousItems);
  const normalizedNextItems = normalizeLineItems(nextItems);
  const stockDeltas = buildProductDeltas(normalizedPreviousItems, normalizedNextItems);

  await runTransaction(db, async (transaction) => {
    await applyStockDeltas(transaction, db, stockDeltas, {
      reason,
      source,
      sourceId: recordRef.id,
      sourceCode,
      actor,
    });

    transaction.update(recordRef, {
      ...recordPatch,
      items: normalizedNextItems,
    });
  });

  return normalizedNextItems;
}

export async function updateProductWithStockMovement({
  db,
  productId,
  product,
  previousProduct,
  actor,
}) {
  const productRef = doc(db, "products", productId);
  const nextStock = getProductStock(product);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(productRef);
    const currentProduct = snapshot.exists() ? snapshot.data() : previousProduct;
    const previousStock = getProductStock(currentProduct);
    const shouldTrackMovement = productTracksStock(product) || productTracksStock(currentProduct);
    const stockDelta = nextStock - previousStock;

    transaction.update(productRef, product);

    if (!shouldTrackMovement || stockDelta === 0) return;

    const movementRef = doc(collection(db, "stockMovements"));
    transaction.set(
      movementRef,
      buildMovement({
        actor,
        reason: "ajuste_manual",
        source: "admin",
        sourceId: productId,
        sourceCode: "",
        entry: {
          productId,
          productTitle: product.title || previousProduct?.title || "Produto",
          stockDelta,
        },
      })
    );
  });
}
