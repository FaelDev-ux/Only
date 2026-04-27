"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, db, googleProvider } from "../lib/firebase";
import { subscribeToUserAccess, syncUserProfile } from "../lib/access-control";
import {
  InventoryError,
  createRecordWithStock,
  getProductStock,
  getProductStockText,
  isActiveStockItem,
  makeLineId,
  normalizeLineItems,
  productHasStock,
  productTracksStock,
  updateRecordItemsWithStock,
} from "../lib/inventory";
import {
  buildGroupedProducts,
  describeAdminAuthError,
  formatDisplayPrice,
  formatPrice,
  generateOrderCode,
  parsePrice,
} from "../lib/store-utils";

const productsCollection = collection(db, "products");
const ordersCollection = collection(db, "orders");
const cashSalesCollection = collection(db, "cashSales");
const cashSessionsCollection = collection(db, "cashSessions");

const initialSaleForm = {
  customerName: "",
  payment: "pix",
  discount: "",
  surcharge: "",
  notes: "",
};

function getDocDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  return null;
}

function getDocTime(value) {
  return getDocDate(value)?.getTime() || 0;
}

function formatDateTime(value) {
  const date = getDocDate(value);
  if (!date) return "Agora";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFullDateTime(value) {
  const date = getDocDate(value);
  if (!date) return "Agora";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeSubProducts(subProducts) {
  if (!Array.isArray(subProducts)) return [];

  return subProducts
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizePayment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildPickerProduct(product) {
  return {
    id: product?.id || "",
    title: product?.title || "",
    price: formatDisplayPrice(product?.price || ""),
    image: product?.image || "",
    subProducts: normalizeSubProducts(product?.subProducts),
    selectedSubProduct: "",
    trackStock: productTracksStock(product),
    stock: getProductStock(product),
    minStock: product?.minStock || 0,
  };
}

function buildSaleItem(product, selectedSubProduct = "") {
  const option = selectedSubProduct.trim();

  return {
    lineId: makeLineId("sale"),
    productId: product.id,
    productTitle: product.title,
    option,
    title: option ? `${product.title} - ${option}` : product.title,
    price: product.price,
    image: product.image || "",
    qty: 1,
    status: "active",
  };
}

function sumByPayment(items, getPayment, getTotal) {
  return items.reduce(
    (totals, item) => {
      const payment = normalizePayment(getPayment(item));
      const value = Number(getTotal(item) || 0);

      totals.total += value;
      if (payment === "dinheiro") totals.cash += value;
      else if (payment === "pix") totals.pix += value;
      else if (payment === "cartao") totals.card += value;
      else totals.other += value;

      return totals;
    },
    { total: 0, cash: 0, pix: 0, card: 0, other: 0 }
  );
}

function filterBySession(items, session) {
  if (!session) return [];

  const openedAt = getDocTime(session.openedAt);
  const closedAt = getDocTime(session.closedAt);

  return items.filter((item) => {
    const createdAt = getDocTime(item.createdAt);
    if (!createdAt || createdAt < openedAt) return false;
    if (closedAt && createdAt > closedAt) return false;
    return true;
  });
}

function filterByToday(items) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;

  return items.filter((item) => {
    const createdAt = getDocTime(item.createdAt);
    return createdAt >= start && createdAt < end;
  });
}

function buildSoldItemsSummary(records) {
  const summary = new Map();

  records.forEach((record) => {
    (record.items || []).filter(isActiveStockItem).forEach((item) => {
      const title = String(item?.title || "Item sem nome").trim();
      if (!title) return;

      const qty = Number(item?.qty || 0) || 0;
      const lineTotal = parsePrice(item?.price || 0) * qty;
      const current = summary.get(title) || {
        title,
        qty: 0,
        total: 0,
      };

      current.qty += qty;
      current.total += lineTotal;
      summary.set(title, current);
    });
  });

  return Array.from(summary.values()).sort((a, b) => {
    if (b.qty !== a.qty) return b.qty - a.qty;
    return b.total - a.total;
  });
}

function buildSessionDetails(session, orders, cashSales) {
  if (!session) return null;

  const sessionOrders = filterBySession(orders, session);
  const sessionCashSales = filterBySession(cashSales, session);
  const onlineTotals = sumByPayment(
    sessionOrders,
    (item) => item.customer?.payment,
    (item) => item.total
  );
  const manualTotals = sumByPayment(
    sessionCashSales,
    (item) => item.payment,
    (item) => item.total
  );
  const movements = [
    ...sessionOrders.map((item) => ({
      id: item.id,
      type: "Pedido online",
      orderCode: item.orderCode || String(item.id || "").slice(0, 8).toUpperCase(),
      customerName: item.customer?.name || "Cliente",
      payment: item.customer?.payment || "Sem pagamento",
      total: Number(item.total || 0),
      createdAt: item.createdAt,
      items: item.items || [],
    })),
    ...sessionCashSales.map((item) => ({
      id: item.id,
      type: "Venda no caixa",
      orderCode: item.orderCode || String(item.id || "").slice(0, 8).toUpperCase(),
      customerName: item.customerName || "Balcao",
      payment: item.payment || "Sem pagamento",
      total: Number(item.total || 0),
      createdAt: item.createdAt,
      items: item.items || [],
    })),
  ].sort((a, b) => getDocTime(b.createdAt) - getDocTime(a.createdAt));

  const soldItems = buildSoldItemsSummary([...sessionOrders, ...sessionCashSales]);
  const totalMovement = onlineTotals.total + manualTotals.total;
  const cashTotal = onlineTotals.cash + manualTotals.cash;

  return {
    sessionOrders,
    sessionCashSales,
    onlineTotals,
    manualTotals,
    movements,
    soldItems,
    totalMovement,
    cashTotal,
  };
}

export default function CashPage() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [authState, setAuthState] = useState({
    loggedIn: false,
    isAdmin: false,
    status: "Verificando sessao...",
    name: "",
    email: "",
    showDenied: false,
  });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cashSales, setCashSales] = useState([]);
  const [cashSessions, setCashSessions] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [saleForm, setSaleForm] = useState(initialSaleForm);
  const [saleCart, setSaleCart] = useState([]);
  const [pickerProduct, setPickerProduct] = useState(null);
  const [exchangeTarget, setExchangeTarget] = useState(null);
  const [exchangeProduct, setExchangeProduct] = useState(null);
  const [openingAmountText, setOpeningAmountText] = useState("0,00");
  const [submittingSale, setSubmittingSale] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState("");

  useEffect(() => {
    let unsubscribeAccess = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      unsubscribeAccess();
      setProducts([]);
      setOrders([]);
      setCashSales([]);
      setCashSessions([]);

      if (!user) {
        setAuthState({
          loggedIn: false,
          isAdmin: false,
          status: "Entre com Google para abrir o caixa.",
          name: "",
          email: "",
          showDenied: false,
        });
        return;
      }

      setAuthState({
        loggedIn: true,
        isAdmin: false,
        status: "Validando permissoes do caixa...",
        name: user.displayName || "Conta Google",
        email: user.email || "",
        showDenied: false,
      });

      try {
        await syncUserProfile(user);
      } catch (error) {
        console.error(error);
        setAuthState({
          loggedIn: true,
          isAdmin: false,
          status: "Nao foi possivel validar o acesso ao caixa agora.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: true,
        });
        return;
      }

      unsubscribeAccess = subscribeToUserAccess(user, (access) => {
        const isBlocked = access.disabled;
        const allowed = access.canAccessCashPanel;

        setAuthState({
          loggedIn: true,
          isAdmin: access.isAdmin,
          status: isBlocked
            ? "Essa conta foi desativada no painel."
            : allowed
              ? "Caixa pronto para uso."
              : "Essa conta ainda nao foi liberada para o caixa.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: isBlocked || !allowed,
        });
      });
    });

    return () => {
      unsubscribeAccess();
      if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
      }
    };
  }, []);

  useEffect(() => {
    if (!authState.loggedIn || !authState.isAdmin) return undefined;

    setProductsLoading(true);

    const unsubscribeProducts = onSnapshot(
      productsCollection,
      (snapshot) => {
        const nextProducts = snapshot.docs
          .map((item) => ({
            id: item.id,
            ...item.data(),
          }))
          .filter((item) => item.available !== false)
          .sort((a, b) =>
            `${a.category || ""}-${a.title || ""}`.localeCompare(
              `${b.category || ""}-${b.title || ""}`,
              "pt-BR"
            )
          );

        setProducts(nextProducts);
        setProductsLoading(false);
      },
      (error) => {
        console.error(error);
        setProducts([]);
        setProductsLoading(false);
      }
    );

    return unsubscribeProducts;
  }, [authState.isAdmin, authState.loggedIn]);

  useEffect(() => {
    if (!authState.loggedIn || !authState.isAdmin) return undefined;

    setOrdersLoading(true);

    const unsubscribeOrders = onSnapshot(
      ordersCollection,
      (snapshot) => {
        const nextOrders = snapshot.docs
          .map((item) => ({
            id: item.id,
            ...item.data(),
          }))
          .sort((a, b) => getDocTime(b.createdAt) - getDocTime(a.createdAt));

        setOrders(nextOrders);
        setOrdersLoading(false);
      },
      (error) => {
        console.error(error);
        setOrders([]);
        setOrdersLoading(false);
      }
    );

    return unsubscribeOrders;
  }, [authState.isAdmin, authState.loggedIn]);

  useEffect(() => {
    if (!authState.loggedIn || !authState.isAdmin) return undefined;

    setSalesLoading(true);

    const unsubscribeSales = onSnapshot(
      cashSalesCollection,
      (snapshot) => {
        const nextSales = snapshot.docs
          .map((item) => ({
            id: item.id,
            ...item.data(),
          }))
          .sort((a, b) => getDocTime(b.createdAt) - getDocTime(a.createdAt));

        setCashSales(nextSales);
        setSalesLoading(false);
      },
      (error) => {
        console.error(error);
        setCashSales([]);
        setSalesLoading(false);
      }
    );

    return unsubscribeSales;
  }, [authState.isAdmin, authState.loggedIn]);

  useEffect(() => {
    if (!authState.loggedIn || !authState.isAdmin) return undefined;

    setSessionsLoading(true);

    const unsubscribeSessions = onSnapshot(
      cashSessionsCollection,
      (snapshot) => {
        const nextSessions = snapshot.docs
          .map((item) => ({
            id: item.id,
            ...item.data(),
          }))
          .sort((a, b) => getDocTime(b.openedAt) - getDocTime(a.openedAt));

        setCashSessions(nextSessions);
        setSessionsLoading(false);
      },
      (error) => {
        console.error(error);
        setCashSessions([]);
        setSessionsLoading(false);
      }
    );

    return unsubscribeSessions;
  }, [authState.isAdmin, authState.loggedIn]);

  const groupedProducts = useMemo(() => buildGroupedProducts(products), [products]);
  const activeSession = useMemo(
    () => cashSessions.find((session) => session.status === "open") || null,
    [cashSessions]
  );
  const recentSessions = useMemo(() => cashSessions.slice(0, 8), [cashSessions]);
  const sessionOrders = useMemo(() => filterBySession(orders, activeSession), [orders, activeSession]);
  const sessionCashSales = useMemo(
    () => filterBySession(cashSales, activeSession),
    [cashSales, activeSession]
  );
  const sessionOnlineTotals = useMemo(
    () => sumByPayment(sessionOrders, (item) => item.customer?.payment, (item) => item.total),
    [sessionOrders]
  );
  const sessionCashSaleTotals = useMemo(
    () => sumByPayment(sessionCashSales, (item) => item.payment, (item) => item.total),
    [sessionCashSales]
  );
  const sessionMovementTotal = sessionOnlineTotals.total + sessionCashSaleTotals.total;
  const sessionCashInflow = sessionOnlineTotals.cash + sessionCashSaleTotals.cash;
  const currentBalance = Number(activeSession?.openingAmount || 0) + sessionCashInflow;
  const saleCartSubtotal = saleCart.reduce((sum, item) => sum + parsePrice(item.price) * item.qty, 0);
  const saleDiscount = Math.max(0, parsePrice(saleForm.discount || "0"));
  const saleSurcharge = Math.max(0, parsePrice(saleForm.surcharge || "0"));
  const saleCartTotal = Math.max(0, saleCartSubtotal - saleDiscount + saleSurcharge);

  const todayOrders = useMemo(() => filterByToday(orders), [orders]);
  const todayCashSales = useMemo(() => filterByToday(cashSales), [cashSales]);
  const todayOnlineTotals = useMemo(
    () => sumByPayment(todayOrders, (item) => item.customer?.payment, (item) => item.total),
    [todayOrders]
  );
  const todayCashTotals = useMemo(
    () => sumByPayment(todayCashSales, (item) => item.payment, (item) => item.total),
    [todayCashSales]
  );
  const todayTotalMovement = todayOnlineTotals.total + todayCashTotals.total;
  const todayOrdersCount = todayOrders.length + todayCashSales.length;
  const todayAverageTicket = todayOrdersCount > 0 ? todayTotalMovement / todayOrdersCount : 0;
  const todaySoldItems = useMemo(
    () => buildSoldItemsSummary([...todayOrders, ...todayCashSales]).slice(0, 8),
    [todayOrders, todayCashSales]
  );
  const todayRecentMovements = useMemo(
    () =>
      [
        ...todayOrders.map((item) => ({
          id: item.id,
          type: "Pedido online",
          customerName: item.customer?.name || "Cliente",
          payment: item.customer?.payment || "Sem pagamento",
          total: Number(item.total || 0),
          createdAt: item.createdAt,
          orderCode: item.orderCode || String(item.id || "").slice(0, 8).toUpperCase(),
        })),
        ...todayCashSales.map((item) => ({
          id: item.id,
          type: "Venda no caixa",
          customerName: item.customerName || "Balcao",
          payment: item.payment || "Sem pagamento",
          total: Number(item.total || 0),
          createdAt: item.createdAt,
          orderCode: item.orderCode || String(item.id || "").slice(0, 8).toUpperCase(),
        })),
      ]
        .sort((a, b) => getDocTime(b.createdAt) - getDocTime(a.createdAt))
        .slice(0, 10),
    [todayCashSales, todayOrders]
  );

  const selectedHistorySession = useMemo(
    () => cashSessions.find((session) => session.id === selectedHistorySessionId) || null,
    [cashSessions, selectedHistorySessionId]
  );
  const selectedHistoryDetails = useMemo(
    () => buildSessionDetails(selectedHistorySession, orders, cashSales),
    [selectedHistorySession, orders, cashSales]
  );

  const sessionRecords = useMemo(
    () =>
      [
        ...sessionOrders.map((record) => ({
          ...record,
          recordType: "order",
          typeLabel: "Pedido online",
          customerName: record.customer?.name || "Cliente",
          payment: record.customer?.payment || "Sem pagamento",
        })),
        ...sessionCashSales.map((record) => ({
          ...record,
          recordType: "cashSale",
          typeLabel: "Venda no caixa",
          customerName: record.customerName || "Balcao",
          payment: record.payment || "Sem pagamento",
        })),
      ].sort((a, b) => getDocTime(b.createdAt) - getDocTime(a.createdAt)),
    [sessionCashSales, sessionOrders]
  );

  function getProductById(productId) {
    return products.find((product) => product.id === productId) || null;
  }

  function getSaleCartQtyForProduct(productId) {
    return saleCart.reduce((sum, item) => {
      if (item.productId !== productId) return sum;
      return sum + Number(item.qty || 0);
    }, 0);
  }

  function canAddSaleProductQty(productId, qty = 1) {
    const product = getProductById(productId);
    if (!productTracksStock(product)) return true;
    return getSaleCartQtyForProduct(productId) + qty <= getProductStock(product);
  }

  function buildRecordPatch(record, nextItems) {
    const subtotal = nextItems
      .filter(isActiveStockItem)
      .reduce((sum, item) => sum + parsePrice(item.price || 0) * Number(item.qty || 0), 0);
    const discount = Math.min(Number(record.discount || 0), subtotal);
    const surcharge = Number(record.surcharge || 0);

    return {
      subtotal,
      discount,
      surcharge,
      total: Math.max(0, subtotal - discount + surcharge),
    };
  }

  function getCollectionName(recordType) {
    return recordType === "cashSale" ? "cashSales" : "orders";
  }

  function getSourceName(recordType) {
    return recordType === "cashSale" ? "cashSale" : "order";
  }

  function requestItemQuantity(item, actionLabel, { confirmSingle = false } = {}) {
    const maxQty = Math.max(1, Math.floor(Number(item?.qty || 1)));

    if (maxQty === 1) {
      if (!confirmSingle) return 1;
      return window.confirm(`Deseja ${actionLabel} 1x ${item.title}?`) ? 1 : null;
    }

    const answer = window.prompt(
      `Quantas unidades deseja ${actionLabel}?`,
      "1"
    );

    if (answer === null) return null;

    const requestedQty = Math.floor(Number(answer.replace(",", ".")));

    if (!Number.isFinite(requestedQty) || requestedQty < 1 || requestedQty > maxQty) {
      setNoticeMessage(`Informe uma quantidade entre 1 e ${maxQty}.`);
      return null;
    }

    return requestedQty;
  }

  function addItemToSale(item) {
    if (!canAddSaleProductQty(item.productId, item.qty || 1)) {
      setNoticeMessage(`${item.productTitle || item.title} nao tem estoque suficiente.`);
      return;
    }

    setSaleCart((current) => {
      const existing = current.find((entry) => entry.title === item.title);

      if (existing) {
        return current.map((entry) =>
          entry.title === item.title ? { ...entry, qty: entry.qty + 1 } : entry
        );
      }

      return [...current, item];
    });
  }

  function handleAddProduct(product) {
    if (!activeSession) {
      setNoticeMessage("Abra o caixa antes de lancar vendas presenciais.");
      return;
    }

    if (!productHasStock(product, 1)) {
      setNoticeMessage(`${product.title} esta sem estoque.`);
      return;
    }

    const nextProduct = buildPickerProduct(product);

    if (nextProduct.subProducts.length > 0) {
      setPickerProduct(nextProduct);
      return;
    }

    addItemToSale(buildSaleItem(nextProduct));
  }

  function updateSaleQty(title, delta) {
    if (delta > 0) {
      const currentItem = saleCart.find((item) => item.title === title);
      if (currentItem && !canAddSaleProductQty(currentItem.productId, delta)) {
        setNoticeMessage(`${currentItem.productTitle || currentItem.title} nao tem estoque suficiente.`);
        return;
      }
    }

    setSaleCart((current) =>
      current
        .map((item) => (item.title === title ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
  }

  function handleSaleFieldChange(event) {
    const { name, value } = event.target;
    setSaleForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleGoogleSignIn() {
    setSigningIn(true);

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error(error);
      setNoticeMessage(describeAdminAuthError(error));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
      setNoticeMessage("Nao foi possivel sair do caixa agora.");
    }
  }

  async function handleOpenSession() {
    if (activeSession) {
      setNoticeMessage("Ja existe um caixa aberto neste momento.");
      return;
    }

    setOpeningSession(true);

    try {
      const openingAmount = Math.max(0, parsePrice(openingAmountText || "0"));

      await addDoc(cashSessionsCollection, {
        status: "open",
        openingAmount,
        openedAt: serverTimestamp(),
        openedByName: authState.name,
        openedByEmail: authState.email,
      });

      setOpeningAmountText("0,00");
      setNoticeMessage("Caixa aberto com sucesso.");
    } catch (error) {
      console.error(error);
      setNoticeMessage("Nao foi possivel abrir o caixa agora.");
    } finally {
      setOpeningSession(false);
    }
  }

  async function handleCloseSession() {
    if (!activeSession) {
      setNoticeMessage("Nao existe caixa aberto para fechar.");
      return;
    }

    setClosingSession(true);

    try {
      const sessionRef = doc(db, "cashSessions", activeSession.id);

      await updateDoc(sessionRef, {
        status: "closed",
        closedAt: serverTimestamp(),
        closedByName: authState.name,
        closedByEmail: authState.email,
        sessionOrdersCount: sessionOrders.length,
        sessionCashSalesCount: sessionCashSales.length,
        onlineOrdersTotal: sessionOnlineTotals.total,
        cashSalesTotal: sessionCashSaleTotals.total,
        moneyPaymentsTotal: sessionOnlineTotals.cash + sessionCashSaleTotals.cash,
        pixPaymentsTotal: sessionOnlineTotals.pix + sessionCashSaleTotals.pix,
        cardPaymentsTotal: sessionOnlineTotals.card + sessionCashSaleTotals.card,
        totalMovement: sessionMovementTotal,
        expectedClosingBalance: currentBalance,
      });

      setSaleCart([]);
      setPickerProduct(null);
      setSaleForm(initialSaleForm);
      setNoticeMessage("Caixa fechado com resumo da sessao.");
    } catch (error) {
      console.error(error);
      setNoticeMessage("Nao foi possivel fechar o caixa agora.");
    } finally {
      setClosingSession(false);
    }
  }

  async function handleFinishSale() {
    if (!activeSession) {
      setNoticeMessage("Abra o caixa antes de registrar uma venda.");
      return;
    }

    if (saleCart.length === 0) {
      setNoticeMessage("Adicione ao menos um item antes de fechar a venda.");
      return;
    }

    setSubmittingSale(true);

    try {
      const items = saleCart.map((item) => ({
        lineId: item.lineId || makeLineId("sale"),
        productId: item.productId || "",
        productTitle: item.productTitle || item.title,
        option: item.option || "",
        title: item.title,
        price: item.price,
        qty: item.qty,
        image: item.image || "",
        status: "active",
      }));
      const orderCode = generateOrderCode();

      const saleRef = doc(cashSalesCollection);

      await createRecordWithStock({
        db,
        recordRef: saleRef,
        items,
        source: "cashSale",
        sourceCode: orderCode,
        actor: {
          name: authState.name,
          email: authState.email,
        },
        recordData: {
        orderCode,
        sessionId: activeSession.id,
        subtotal: saleCartSubtotal,
        discount: saleDiscount,
        surcharge: saleSurcharge,
        total: saleCartTotal,
        payment: saleForm.payment,
        customerName: saleForm.customerName.trim(),
        notes: saleForm.notes.trim(),
        source: "caixa",
        createdAt: serverTimestamp(),
        },
      });

      setSaleCart([]);
      setSaleForm(initialSaleForm);
      setNoticeMessage("Venda registrada no caixa com sucesso.");
    } catch (error) {
      console.error(error);
      setNoticeMessage(
        error instanceof InventoryError
          ? error.message
          : "Nao foi possivel registrar essa venda agora."
      );
    } finally {
      setSubmittingSale(false);
    }
  }

  async function handleCancelRecordItem(recordType, record, itemIndex) {
    const previousItems = normalizeLineItems(record.items);
    const targetItem = previousItems[itemIndex];

    if (!targetItem || !isActiveStockItem(targetItem)) return;

    const qtyToCancel = requestItemQuantity(targetItem, "cancelar", { confirmSingle: true });
    if (!qtyToCancel) return;

    const targetQty = Math.max(1, Math.floor(Number(targetItem.qty || 1)));
    const cancelledAt = new Date().toISOString();

    const nextItems = previousItems.flatMap((item, index) => {
      if (index !== itemIndex) return [item];

      const cancelledItem = {
        ...item,
        qty: qtyToCancel,
        status: "cancelled",
        cancelledAt,
        cancelledByName: authState.name,
        cancelledByEmail: authState.email,
      };

      if (qtyToCancel >= targetQty) return [cancelledItem];

      return [
        {
          ...item,
          qty: targetQty - qtyToCancel,
        },
        {
          ...cancelledItem,
          lineId: makeLineId("cancelled"),
          cancelledFromLineId: item.lineId,
        },
      ];
    });

    try {
      const recordRef = doc(db, getCollectionName(recordType), record.id);

      await updateRecordItemsWithStock({
        db,
        recordRef,
        previousItems,
        nextItems,
        recordPatch: buildRecordPatch(record, nextItems),
        reason: "cancelamento",
        source: getSourceName(recordType),
        sourceCode: record.orderCode || "",
        actor: {
          name: authState.name,
          email: authState.email,
        },
      });

      setNoticeMessage("Item cancelado e estoque devolvido.");
    } catch (error) {
      console.error(error);
      setNoticeMessage(
        error instanceof InventoryError
          ? error.message
          : "Nao foi possivel cancelar este item agora."
      );
    }
  }

  function openExchangeItem(recordType, record, itemIndex) {
    const previousItems = normalizeLineItems(record.items);
    const targetItem = previousItems[itemIndex];

    if (!targetItem || !isActiveStockItem(targetItem)) return;

    const qtyToExchange = requestItemQuantity(targetItem, "trocar");
    if (!qtyToExchange) return;

    setExchangeTarget({
      recordType,
      record,
      itemIndex,
      item: targetItem,
      qty: qtyToExchange,
    });
    setExchangeProduct(null);
  }

  function closeExchangeModal() {
    setExchangeTarget(null);
    setExchangeProduct(null);
  }

  function chooseExchangeProduct(product) {
    if (!exchangeTarget) return;

    const exchangeQty = Math.max(1, Math.floor(Number(exchangeTarget.qty || 1)));
    const sameProduct = exchangeTarget.item.productId === product.id;
    if (!sameProduct && !productHasStock(product, exchangeQty)) {
      setNoticeMessage(`${product.title} esta sem estoque.`);
      return;
    }

    const nextProduct = buildPickerProduct(product);

    if (nextProduct.subProducts.length > 0) {
      setExchangeProduct(nextProduct);
      return;
    }

    handleConfirmExchange(nextProduct, "");
  }

  async function handleConfirmExchange(product, selectedSubProduct = "") {
    if (!exchangeTarget) return;

    const previousItems = normalizeLineItems(exchangeTarget.record.items);
    const targetItem = previousItems[exchangeTarget.itemIndex];
    if (!targetItem || !isActiveStockItem(targetItem)) return;

    const targetQty = Math.max(1, Math.floor(Number(targetItem.qty || 1)));
    const exchangeQty = Math.min(
      targetQty,
      Math.max(1, Math.floor(Number(exchangeTarget.qty || 1)))
    );
    const exchangedAt = new Date().toISOString();
    const replacement = {
      ...buildSaleItem(product, selectedSubProduct),
      qty: exchangeQty,
      exchangedFromLineId: targetItem.lineId,
      exchangedFromTitle: targetItem.title,
      exchangedAt,
      exchangedByName: authState.name,
      exchangedByEmail: authState.email,
    };

    const nextItems = [
      ...previousItems.flatMap((item, index) => {
        if (index !== exchangeTarget.itemIndex) return [item];

        const replacedItem = {
          ...item,
          qty: exchangeQty,
          status: "replaced",
          replacedByLineId: replacement.lineId,
          replacedAt: exchangedAt,
          replacedByName: authState.name,
          replacedByEmail: authState.email,
        };

        if (exchangeQty >= targetQty) return [replacedItem];

        return [
          {
            ...item,
            qty: targetQty - exchangeQty,
          },
          {
            ...replacedItem,
            lineId: makeLineId("replaced"),
            replacedFromLineId: item.lineId,
          },
        ];
      }),
      replacement,
    ];

    try {
      const recordRef = doc(
        db,
        getCollectionName(exchangeTarget.recordType),
        exchangeTarget.record.id
      );

      await updateRecordItemsWithStock({
        db,
        recordRef,
        previousItems,
        nextItems,
        recordPatch: buildRecordPatch(exchangeTarget.record, nextItems),
        reason: "troca",
        source: getSourceName(exchangeTarget.recordType),
        sourceCode: exchangeTarget.record.orderCode || "",
        actor: {
          name: authState.name,
          email: authState.email,
        },
      });

      closeExchangeModal();
      setNoticeMessage("Troca registrada e estoque ajustado.");
    } catch (error) {
      console.error(error);
      setNoticeMessage(
        error instanceof InventoryError
          ? error.message
          : "Nao foi possivel trocar este item agora."
      );
    }
  }

  return (
    <div className="cash-page">
      <header className="cash-header admin-card">
        <div className="cash-brand">
          <div className="cash-logo-wrap">
            <img src="/logo.jpeg" alt="Logo Bolo de Mae JP Confeitaria" />
          </div>

          <div>
            <p className="eyebrow">Operacao interna</p>
            <h1>Sistema de Caixa</h1>
            <p className="cash-copy">
              Caixa ligado ao cardapio, lendo os mesmos produtos e acompanhando os pedidos da loja.
            </p>
          </div>
        </div>

        <div className="cash-top-actions">
          <Link className="secondary-button" href="/">
            Ver cardapio
          </Link>
          <Link className="secondary-button" href="/admin">
            Gerenciar produtos
          </Link>
          {authState.loggedIn ? (
            <button type="button" className="primary-button" onClick={handleSignOut}>
              Sair
            </button>
          ) : null}
        </div>
      </header>

      {!authState.loggedIn || !authState.isAdmin ? (
        <section className="auth-card">
          <p className="eyebrow">Acesso interno</p>
          <h2>Entrar no caixa</h2>
          <p className="auth-copy">
            Use a conta Google liberada como admin para abrir o sistema de caixa da loja.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={handleGoogleSignIn}
            disabled={signingIn}
          >
            {signingIn ? "Abrindo login..." : "Entrar com Google"}
          </button>
          <p className="auth-status">{authState.status}</p>
        </section>
      ) : null}

      {authState.showDenied ? (
        <section className="auth-card auth-card-danger">
          <p className="eyebrow">Sem permissao</p>
          <h2>Conta ainda nao liberada</h2>
          <p className="auth-copy">
            A conta entrou com sucesso, mas ainda precisa estar marcada como admin no Firestore
            para operar o caixa.
          </p>
        </section>
      ) : null}

      {authState.loggedIn && authState.isAdmin ? (
        <div className="cash-shell">
          <div className="status-banner">{authState.status}</div>

          <section className="admin-card cash-session-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Sessao de caixa</p>
                <h2>{activeSession ? "Caixa aberto" : "Abrir caixa"}</h2>
              </div>
              <span className="pill">
                {sessionsLoading ? "Carregando..." : activeSession ? "Sessao ativa" : "Caixa fechado"}
              </span>
            </div>

            {activeSession ? (
              <div className="cash-session-grid">
                <div className="cash-session-card">
                  <span className="summary-label">Aberto por</span>
                  <strong>{activeSession.openedByName || "Admin"}</strong>
                  <small>{activeSession.openedByEmail || "Sem email"}</small>
                  <small>{formatDateTime(activeSession.openedAt)}</small>
                </div>

                <div className="cash-session-card">
                  <span className="summary-label">Valor inicial</span>
                  <strong>{formatPrice(Number(activeSession.openingAmount || 0))}</strong>
                  <small>Fundo inicial do caixa</small>
                </div>

                <div className="cash-session-card cash-session-card-highlight">
                  <span className="summary-label">Saldo atual esperado</span>
                  <strong>{formatPrice(currentBalance)}</strong>
                  <small>Valor inicial + vendas em dinheiro</small>
                </div>
              </div>
            ) : (
              <div className="cash-open-box">
                <label className="cash-open-label">
                  Valor inicial
                  <input
                    type="text"
                    value={openingAmountText}
                    onChange={(event) => setOpeningAmountText(event.target.value)}
                    placeholder="0,00"
                  />
                </label>

                <button
                  type="button"
                  className="modal-add"
                  onClick={handleOpenSession}
                  disabled={openingSession}
                >
                  {openingSession ? "Abrindo..." : "Abrir caixa"}
                </button>
              </div>
            )}

            {activeSession ? (
              <div className="cash-close-summary">
                <div className="summary-grid summary-grid-compact">
                  <article className="summary-card">
                    <span className="summary-label">Pedidos na sessao</span>
                    <strong>{sessionOrders.length}</strong>
                    <small>{formatPrice(sessionOnlineTotals.total)}</small>
                  </article>

                  <article className="summary-card">
                    <span className="summary-label">Vendas no caixa</span>
                    <strong>{sessionCashSales.length}</strong>
                    <small>{formatPrice(sessionCashSaleTotals.total)}</small>
                  </article>

                  <article className="summary-card">
                    <span className="summary-label">Movimento da sessao</span>
                    <strong>{formatPrice(sessionMovementTotal)}</strong>
                    <small>Total entre online e presencial</small>
                  </article>
                </div>

                <div className="cash-payments-grid">
                  <div className="cash-payment-chip">
                    <span>Dinheiro</span>
                    <strong>{formatPrice(sessionOnlineTotals.cash + sessionCashSaleTotals.cash)}</strong>
                  </div>
                  <div className="cash-payment-chip">
                    <span>Pix</span>
                    <strong>{formatPrice(sessionOnlineTotals.pix + sessionCashSaleTotals.pix)}</strong>
                  </div>
                  <div className="cash-payment-chip">
                    <span>Cartao</span>
                    <strong>{formatPrice(sessionOnlineTotals.card + sessionCashSaleTotals.card)}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleCloseSession}
                  disabled={closingSession}
                >
                  {closingSession ? "Fechando..." : "Fechar caixa com resumo"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="admin-card cash-sections-card">
            <div className="cash-section-tabs">
              <button
                type="button"
                className={`cash-section-tab${activeSection === "dashboard" ? " is-active" : ""}`}
                onClick={() => setActiveSection("dashboard")}
              >
                Dashboard do dia
              </button>
              <button
                type="button"
                className={`cash-section-tab${activeSection === "sales" ? " is-active" : ""}`}
                onClick={() => setActiveSection("sales")}
              >
                Frente de caixa
              </button>
              <button
                type="button"
                className={`cash-section-tab${activeSection === "orders" ? " is-active" : ""}`}
                onClick={() => setActiveSection("orders")}
              >
                Pedidos e vendas
              </button>
              <button
                type="button"
                className={`cash-section-tab${activeSection === "history" ? " is-active" : ""}`}
                onClick={() => setActiveSection("history")}
              >
                Historico do caixa
              </button>
            </div>
          </section>

          {activeSection === "dashboard" ? (
            <div className="cash-dashboard-layout">
              <section className="admin-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Resumo geral</p>
                    <h2>Dashboard do dia</h2>
                  </div>
                  <span className="pill">
                    {ordersLoading || salesLoading ? "Atualizando..." : `${todayOrdersCount} movimentos`}
                  </span>
                </div>

                <div className="cash-dashboard-grid">
                  <article className="summary-card">
                    <span className="summary-label">Total vendido hoje</span>
                    <strong>{formatPrice(todayTotalMovement)}</strong>
                    <small>Online + presencial</small>
                  </article>

                  <article className="summary-card">
                    <span className="summary-label">Ticket medio</span>
                    <strong>{formatPrice(todayAverageTicket)}</strong>
                    <small>Media por pedido ou venda</small>
                  </article>

                  <article className="summary-card">
                    <span className="summary-label">Pedidos online</span>
                    <strong>{todayOrders.length}</strong>
                    <small>{formatPrice(todayOnlineTotals.total)}</small>
                  </article>

                  <article className="summary-card">
                    <span className="summary-label">Vendas no caixa</span>
                    <strong>{todayCashSales.length}</strong>
                    <small>{formatPrice(todayCashTotals.total)}</small>
                  </article>
                </div>

                <div className="cash-payments-grid">
                  <div className="cash-payment-chip">
                    <span>Dinheiro</span>
                    <strong>{formatPrice(todayOnlineTotals.cash + todayCashTotals.cash)}</strong>
                  </div>
                  <div className="cash-payment-chip">
                    <span>Pix</span>
                    <strong>{formatPrice(todayOnlineTotals.pix + todayCashTotals.pix)}</strong>
                  </div>
                  <div className="cash-payment-chip">
                    <span>Cartao</span>
                    <strong>{formatPrice(todayOnlineTotals.card + todayCashTotals.card)}</strong>
                  </div>
                  <div className="cash-payment-chip">
                    <span>Outros</span>
                    <strong>{formatPrice(todayOnlineTotals.other + todayCashTotals.other)}</strong>
                  </div>
                </div>
              </section>

              <section className="admin-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Produtos do dia</p>
                    <h2>Mais vendidos</h2>
                  </div>
                  <span className="pill">{todaySoldItems.length} itens destacados</span>
                </div>

                {todaySoldItems.length === 0 ? (
                  <div className="empty-state">Ainda nao houve vendas hoje.</div>
                ) : (
                  <div className="detail-list">
                    {todaySoldItems.map((item) => (
                      <div className="detail-list-item" key={item.title}>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.qty} unidades</small>
                        </div>
                        <strong>{formatPrice(item.total)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="admin-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Movimentacao recente</p>
                    <h2>Ultimas vendas do dia</h2>
                  </div>
                  <span className="pill">{todayRecentMovements.length} registros</span>
                </div>

                {todayRecentMovements.length === 0 ? (
                  <div className="empty-state">Nenhum movimento registrado hoje.</div>
                ) : (
                  <div className="order-list">
                    {todayRecentMovements.map((movement) => (
                      <article className="order-card" key={`${movement.type}-${movement.id}`}>
                        <div className="order-card-top">
                          <strong>
                            #{movement.orderCode} - {movement.customerName}
                          </strong>
                          <span>{formatDateTime(movement.createdAt)}</span>
                        </div>
                        <small>
                          {movement.type} - {movement.payment}
                        </small>
                        <div className="order-card-bottom">
                          <span>Resumo do dia</span>
                          <strong>{formatPrice(movement.total)}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : null}
          {activeSection === "sales" ? (
            <div className="cash-layout">
              <section className="admin-card sales-builder">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Venda manual</p>
                    <h2>Frente de caixa</h2>
                  </div>
                  <span className="pill">
                    {productsLoading ? "Carregando produtos..." : `${products.length} itens`}
                  </span>
                </div>

                <div className="cash-form-grid">
                  <label>
                    Cliente
                    <input
                      type="text"
                      name="customerName"
                      placeholder="Opcional"
                      value={saleForm.customerName}
                      onChange={handleSaleFieldChange}
                    />
                  </label>

                  <label>
                    Pagamento
                    <select name="payment" value={saleForm.payment} onChange={handleSaleFieldChange}>
                      <option value="pix">Pix</option>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="cartao">Cartao</option>
                    </select>
                  </label>

                  <label>
                    Desconto
                    <input
                      type="text"
                      name="discount"
                      placeholder="0,00"
                      value={saleForm.discount}
                      onChange={handleSaleFieldChange}
                    />
                  </label>

                  <label>
                    Acrescimo
                    <input
                      type="text"
                      name="surcharge"
                      placeholder="0,00"
                      value={saleForm.surcharge}
                      onChange={handleSaleFieldChange}
                    />
                  </label>

                  <label className="full">
                    Observacoes
                    <textarea
                      rows="3"
                      name="notes"
                      placeholder="Ex.: venda presencial, encomenda retirada, troco para 100..."
                      value={saleForm.notes}
                      onChange={handleSaleFieldChange}
                    />
                  </label>
                </div>

                <div className="cash-product-groups">
                  {groupedProducts.map(({ category, products: categoryProducts }) => (
                    <div key={category} className="cash-category-block">
                      <h3>{category}</h3>
                      <div className="cash-product-grid">
                        {categoryProducts.map((product) => {
                          const outOfStock = !productHasStock(product, 1);

                          return (
                            <button
                              key={product.id}
                              type="button"
                              className="cash-product-button"
                              onClick={() => handleAddProduct(product)}
                              disabled={outOfStock}
                            >
                              <span>{product.title}</span>
                              <strong>{formatDisplayPrice(product.price)}</strong>
                              {productTracksStock(product) ? (
                                <small className={outOfStock ? "stock-low" : ""}>
                                  {getProductStockText(product)}
                                </small>
                              ) : Array.isArray(product.subProducts) && product.subProducts.length > 0 ? (
                                <small>{product.subProducts.length} opcoes</small>
                              ) : (
                                <small>Adicionar direto</small>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="admin-card sales-cart-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Venda atual</p>
                    <h2>Carrinho do caixa</h2>
                  </div>
                  <span className="pill">{saleCart.reduce((sum, item) => sum + item.qty, 0)} itens</span>
                </div>
                {saleCart.length === 0 ? (
                  <div className="empty-state">
                    Toque nos produtos ao lado para montar a venda presencial.
                  </div>
                ) : (
                  <div className="mini-list">
                    {saleCart.map((item) => (
                      <div className="mini-list-item" key={item.title}>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.price}</small>
                        </div>
                        <div className="cart-item-controls">
                          <button type="button" onClick={() => updateSaleQty(item.title, -1)}>
                            -
                          </button>
                          <span>{item.qty}</span>
                          <button type="button" onClick={() => updateSaleQty(item.title, 1)}>
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="cash-total-box">
                  <div className="cash-total-lines">
                    <span>Subtotal: {formatPrice(saleCartSubtotal)}</span>
                    <span>Desconto: {formatPrice(saleDiscount)}</span>
                    <span>Acrescimo: {formatPrice(saleSurcharge)}</span>
                  </div>
                  <strong>{formatPrice(saleCartTotal)}</strong>
                </div>

                <button
                  type="button"
                  className="modal-add"
                  onClick={handleFinishSale}
                  disabled={submittingSale || !activeSession}
                >
                  {submittingSale ? "Registrando..." : "Fechar venda no caixa"}
                </button>
              </section>
            </div>
          ) : null}

          {activeSection === "orders" ? (
            <section className="admin-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Integracao com o cardapio</p>
                  <h2>Pedidos e vendas da sessao</h2>
                </div>
                <span className="pill">
                  {ordersLoading || salesLoading ? "Atualizando..." : `${sessionRecords.length} movimentos`}
                </span>
              </div>

              {sessionRecords.length === 0 ? (
                <div className="empty-state">
                  Nenhum pedido ou venda entrou durante a sessao atual.
                </div>
              ) : (
                <div className="order-list">
                  {sessionRecords.slice(0, 14).map((order) => (
                    <article className="order-card" key={order.id}>
                      <div className="order-card-top">
                        <strong>
                          #{order.orderCode || String(order.id || "").slice(0, 8).toUpperCase()} -{" "}
                          {order.customer?.name || "Cliente"}
                        </strong>
                        <span>{formatDateTime(order.createdAt)}</span>
                      </div>
                      <small>
                        {order.typeLabel} - {order.payment}
                      </small>
                      <div className="record-item-list">
                        {normalizeLineItems(order.items).map((item, index) => {
                          const activeItem = isActiveStockItem(item);

                          return (
                            <div
                              className={`record-item-line${activeItem ? "" : " is-inactive"}`}
                              key={item.lineId || `${order.id}-${index}`}
                            >
                              <div>
                                <strong>{item.qty}x {item.title}</strong>
                                <small>
                                  {activeItem
                                    ? item.price
                                    : item.status === "cancelled"
                                      ? "Cancelado"
                                      : "Trocado"}
                                </small>
                              </div>
                              {activeItem ? (
                                <div className="record-item-actions">
                                  <button
                                    type="button"
                                    onClick={() => handleCancelRecordItem(order.recordType, order, index)}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openExchangeItem(order.recordType, order, index)}
                                  >
                                    Trocar
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="order-card-bottom">
                        <span>{order.customer?.phone || order.customerName || "Sem telefone"}</span>
                        <strong>{formatPrice(Number(order.total || 0))}</strong>
                      </div>
                      {(Number(order.discount || 0) > 0 || Number(order.surcharge || 0) > 0) ? (
                        <small>
                          Subtotal: {formatPrice(Number(order.subtotal || order.total || 0))} | Desconto:{" "}
                          {formatPrice(Number(order.discount || 0))} | Acrescimo:{" "}
                          {formatPrice(Number(order.surcharge || 0))}
                        </small>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "history" ? (
            <section className="admin-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Historico do caixa</p>
                  <h2>Sessoes detalhadas</h2>
                </div>
                <span className="pill">
                  {sessionsLoading ? "Atualizando..." : `${recentSessions.length} sessoes`}
                </span>
              </div>

              {recentSessions.length === 0 ? (
                <div className="empty-state">Nenhuma sessao registrada ainda.</div>
              ) : (
                <div className="order-list">
                  {recentSessions.map((session) => {
                    const details = buildSessionDetails(session, orders, cashSales);

                    return (
                      <button
                        type="button"
                        className="order-card order-card-button"
                        key={session.id}
                        onClick={() => setSelectedHistorySessionId(session.id)}
                      >
                        <div className="order-card-top">
                          <strong>{session.status === "open" ? "Caixa aberto" : "Caixa fechado"}</strong>
                          <span>{formatDateTime(session.openedAt)}</span>
                        </div>
                        <small>
                          Aberto por {session.openedByName || "Admin"} - {session.openedByEmail || "Sem email"}
                        </small>
                        <p className="order-card-lines">
                          Vendeu {formatPrice(details?.totalMovement || 0)} | Pix:{" "}
                          {formatPrice((details?.onlineTotals.pix || 0) + (details?.manualTotals.pix || 0))} |
                          Dinheiro:{" "}
                          {formatPrice((details?.onlineTotals.cash || 0) + (details?.manualTotals.cash || 0))}
                        </p>
                        <div className="order-card-bottom">
                          <span>
                            {session.closedByName
                              ? `Fechado por ${session.closedByName}`
                              : "Sessao ainda em andamento"}
                          </span>
                          <strong>{session.closedAt ? formatDateTime(session.closedAt) : "Ver detalhes"}</strong>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      <div className={`modal${pickerProduct ? " is-open" : ""}`} aria-hidden={pickerProduct ? "false" : "true"}>
        <div className="modal-backdrop" onClick={() => setPickerProduct(null)} />
        {pickerProduct ? (
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cash-option-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setPickerProduct(null)}
            >
              x
            </button>

            <div
              className={`modal-photo${pickerProduct.image ? " has-image" : ""}`}
              data-label="Foto"
              style={
                pickerProduct.image
                  ? {
                      backgroundImage: `url("${pickerProduct.image}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            />

            <div className="modal-content">
              <h3 id="cash-option-title">{pickerProduct.title}</h3>
              <p className="modal-price">{pickerProduct.price}</p>
              <p className="modal-details">Escolha a variacao para lancar esse produto no caixa.</p>

              <div className="modal-options">
                <p className="modal-options-label">Opcoes disponiveis</p>
                <div className="modal-options-grid">
                  {pickerProduct.subProducts.map((subProduct) => (
                    <button
                      key={subProduct}
                      type="button"
                      className={`modal-option-button${
                        pickerProduct.selectedSubProduct === subProduct ? " is-selected" : ""
                      }`}
                      onClick={() =>
                        setPickerProduct((current) =>
                          current ? { ...current, selectedSubProduct: subProduct } : current
                        )
                      }
                    >
                      {subProduct}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              className="modal-add"
              type="button"
              disabled={!pickerProduct.selectedSubProduct}
              onClick={() => {
                addItemToSale(buildSaleItem(pickerProduct, pickerProduct.selectedSubProduct));
                setPickerProduct(null);
              }}
            >
              {pickerProduct.selectedSubProduct
                ? `Adicionar ${pickerProduct.selectedSubProduct}`
                : "Escolha uma opcao"}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`modal${exchangeTarget ? " is-open" : ""}`}
        aria-hidden={exchangeTarget ? "false" : "true"}
      >
        <div className="modal-backdrop" onClick={closeExchangeModal} />
        {exchangeTarget ? (
          <div
            className="modal-card modal-card-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exchange-title"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={closeExchangeModal}
            >
              x
            </button>

            <div className="modal-content">
              <p className="eyebrow">Troca de item</p>
              <h3 id="exchange-title">
                {exchangeTarget.qty}x {exchangeTarget.item.title}
              </h3>
              <p className="modal-details">
                Escolha o novo produto. A quantidade escolhida volta para o estoque e o novo sai
                automaticamente.
              </p>
            </div>

            <div className="cash-product-groups">
              {groupedProducts.map(({ category, products: categoryProducts }) => (
                <div key={category} className="cash-category-block">
                  <h3>{category}</h3>
                  <div className="cash-product-grid">
                    {categoryProducts.map((product) => {
                      const sameProduct = exchangeTarget.item.productId === product.id;
                      const outOfStock =
                        !sameProduct && !productHasStock(product, exchangeTarget.qty || 1);

                      return (
                        <button
                          key={product.id}
                          type="button"
                          className="cash-product-button"
                          onClick={() => chooseExchangeProduct(product)}
                          disabled={outOfStock}
                        >
                          <span>{product.title}</span>
                          <strong>{formatDisplayPrice(product.price)}</strong>
                          {productTracksStock(product) ? (
                            <small className={outOfStock ? "stock-low" : ""}>
                              {sameProduct ? "Mesmo produto" : getProductStockText(product)}
                            </small>
                          ) : Array.isArray(product.subProducts) && product.subProducts.length > 0 ? (
                            <small>{product.subProducts.length} opcoes</small>
                          ) : (
                            <small>Trocar para este item</small>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {exchangeProduct ? (
              <div className="modal-options">
                <p className="modal-options-label">Escolha a variacao</p>
                <div className="modal-options-grid">
                  {exchangeProduct.subProducts.map((subProduct) => (
                    <button
                      key={subProduct}
                      type="button"
                      className={`modal-option-button${
                        exchangeProduct.selectedSubProduct === subProduct ? " is-selected" : ""
                      }`}
                      onClick={() =>
                        setExchangeProduct((current) =>
                          current ? { ...current, selectedSubProduct: subProduct } : current
                        )
                      }
                    >
                      {subProduct}
                    </button>
                  ))}
                </div>
                <button
                  className="modal-add"
                  type="button"
                  disabled={!exchangeProduct.selectedSubProduct}
                  onClick={() =>
                    handleConfirmExchange(exchangeProduct, exchangeProduct.selectedSubProduct)
                  }
                >
                  Confirmar troca
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={`modal${selectedHistorySession && selectedHistoryDetails ? " is-open" : ""}`}
        aria-hidden={selectedHistorySession && selectedHistoryDetails ? "false" : "true"}
      >
        <div className="modal-backdrop" onClick={() => setSelectedHistorySessionId("")} />
        {selectedHistorySession && selectedHistoryDetails ? (
          <div
            className="modal-card modal-card-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-session-title"
          >
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setSelectedHistorySessionId("")}
            >
              x
            </button>

            <div className="modal-content">
              <p className="eyebrow">Resumo detalhado</p>
              <h3 id="history-session-title">
                {selectedHistorySession.status === "open" ? "Caixa em andamento" : "Caixa fechado"}
              </h3>
              <p className="modal-details">
                Aberto por {selectedHistorySession.openedByName || "Admin"} em{" "}
                {formatFullDateTime(selectedHistorySession.openedAt)}
                {selectedHistorySession.closedAt
                  ? ` e fechado por ${selectedHistorySession.closedByName || "Admin"} em ${formatFullDateTime(
                      selectedHistorySession.closedAt
                    )}.`
                  : "."}
              </p>
            </div>

            <div className="cash-dashboard-grid">
              <article className="summary-card">
                <span className="summary-label">Total vendido</span>
                <strong>{formatPrice(selectedHistoryDetails.totalMovement)}</strong>
                <small>Resumo da sessao</small>
              </article>

              <article className="summary-card">
                <span className="summary-label">Pedidos online</span>
                <strong>{selectedHistoryDetails.sessionOrders.length}</strong>
                <small>{formatPrice(selectedHistoryDetails.onlineTotals.total)}</small>
              </article>

              <article className="summary-card">
                <span className="summary-label">Vendas presenciais</span>
                <strong>{selectedHistoryDetails.sessionCashSales.length}</strong>
                <small>{formatPrice(selectedHistoryDetails.manualTotals.total)}</small>
              </article>

              <article className="summary-card">
                <span className="summary-label">Saldo em dinheiro</span>
                <strong>{formatPrice(Number(selectedHistorySession.openingAmount || 0) + selectedHistoryDetails.cashTotal)}</strong>
                <small>Fundo inicial + entradas em dinheiro</small>
              </article>
            </div>

            <div className="cash-payments-grid">
              <div className="cash-payment-chip">
                <span>Dinheiro</span>
                <strong>
                  {formatPrice(selectedHistoryDetails.onlineTotals.cash + selectedHistoryDetails.manualTotals.cash)}
                </strong>
              </div>
              <div className="cash-payment-chip">
                <span>Pix</span>
                <strong>
                  {formatPrice(selectedHistoryDetails.onlineTotals.pix + selectedHistoryDetails.manualTotals.pix)}
                </strong>
              </div>
              <div className="cash-payment-chip">
                <span>Cartao</span>
                <strong>
                  {formatPrice(selectedHistoryDetails.onlineTotals.card + selectedHistoryDetails.manualTotals.card)}
                </strong>
              </div>
              <div className="cash-payment-chip">
                <span>Outros</span>
                <strong>
                  {formatPrice(selectedHistoryDetails.onlineTotals.other + selectedHistoryDetails.manualTotals.other)}
                </strong>
              </div>
            </div>

            <div className="cash-detail-layout">
              <section className="cash-detail-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Itens vendidos</p>
                    <h2>O que foi vendido</h2>
                  </div>
                  <span className="pill">{selectedHistoryDetails.soldItems.length} itens</span>
                </div>

                {selectedHistoryDetails.soldItems.length === 0 ? (
                  <div className="empty-state">Nenhum item vendido nessa sessao.</div>
                ) : (
                  <div className="detail-list">
                    {selectedHistoryDetails.soldItems.map((item) => (
                      <div className="detail-list-item" key={item.title}>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.qty} unidades vendidas</small>
                        </div>
                        <strong>{formatPrice(item.total)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="cash-detail-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Movimentos da sessao</p>
                    <h2>Pedidos e vendas</h2>
                  </div>
                  <span className="pill">{selectedHistoryDetails.movements.length} registros</span>
                </div>

                {selectedHistoryDetails.movements.length === 0 ? (
                  <div className="empty-state">Nenhum movimento encontrado nessa sessao.</div>
                ) : (
                  <div className="detail-list">
                    {selectedHistoryDetails.movements.map((movement) => (
                      <div className="detail-list-item detail-list-item-stacked" key={`${movement.type}-${movement.id}`}>
                        <div>
                          <strong>
                            #{movement.orderCode} - {movement.customerName}
                          </strong>
                          <small>
                            {movement.type} - {movement.payment} - {formatFullDateTime(movement.createdAt)}
                          </small>
                          <small>
                            {(movement.items || []).map((item) => `${item.qty}x ${item.title}`).join(" - ")}
                          </small>
                        </div>
                        <strong>{formatPrice(movement.total)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <button className="modal-add" type="button" onClick={() => setSelectedHistorySessionId("")}>
              Fechar resumo
            </button>
          </div>
        ) : null}
      </div>

      <div className={`modal${noticeMessage ? " is-open" : ""}`} aria-hidden={noticeMessage ? "false" : "true"}>
        <div className="modal-backdrop" onClick={() => setNoticeMessage("")} />
        {noticeMessage ? (
          <div className="modal-card notice-card" role="dialog" aria-modal="true" aria-labelledby="cash-notice-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setNoticeMessage("")}
            >
              x
            </button>
            <div className="modal-content">
              <h3 id="cash-notice-title">Aviso</h3>
              <p className="modal-details">{noticeMessage}</p>
            </div>
            <button className="modal-add" type="button" onClick={() => setNoticeMessage("")}>
              Entendi
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
