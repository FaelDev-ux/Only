"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, db, googleProvider } from "../lib/firebase";
import { subscribeToUserAccess, syncUserProfile } from "../lib/access-control";
import {
  getProductStockText,
  normalizeStockNumber,
  productTracksStock,
  updateProductWithStockMovement,
} from "../lib/inventory";
import {
  describeAdminAuthError,
  formatDisplayPrice,
} from "../lib/store-utils";

const productsCollection = collection(db, "products");

const initialFormState = {
  title: "",
  category: "",
  price: "",
  image: "",
  details: "",
  subProductsText: "",
  available: true,
  trackStock: false,
  stock: "",
  minStock: "",
};

const MAX_IMAGE_DATA_URL_LENGTH = 450000;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Nao foi possivel ler a foto selecionada."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Nao foi possivel ler a foto selecionada."));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageFile(file) {
  const image = await loadImageFromFile(file);
  let width = image.width;
  let height = image.height;
  const maxSide = 1400;

  if (width > maxSide || height > maxSide) {
    const scale = Math.min(maxSide / width, maxSide / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel preparar a foto para envio.");
  }

  let quality = 0.86;
  let attempts = 0;
  let output = "";

  while (attempts < 6) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    output = canvas.toDataURL("image/jpeg", quality);

    if (output.length <= MAX_IMAGE_DATA_URL_LENGTH) {
      return output;
    }

    quality = Math.max(0.5, quality - 0.08);
    width = Math.max(700, Math.round(width * 0.88));
    height = Math.max(700, Math.round(height * 0.88));
    attempts += 1;
  }

  if (output.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("A foto ficou muito pesada. Tente uma imagem menor ou mais simples.");
  }

  return output;
}

function parseSubProductsText(value) {
  const uniqueOptions = new Set();

  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => uniqueOptions.add(item));

  return Array.from(uniqueOptions).slice(0, 20);
}

function buildFormStateFromProduct(product) {
  return {
    title: product?.title || "",
    category: product?.category || "",
    price: product?.price || "",
    image: product?.image || "",
    details: product?.details || "",
    subProductsText: Array.isArray(product?.subProducts) ? product.subProducts.join("\n") : "",
    available: product?.available !== false,
    trackStock: productTracksStock(product),
    stock: product?.stock ?? "",
    minStock: product?.minStock ?? "",
  };
}

function getProductInventoryStatus(product) {
  if (!productTracksStock(product)) return "free";
  const stock = normalizeStockNumber(product?.stock, 0);
  const minStock = normalizeStockNumber(product?.minStock, 0);
  if (stock <= 0) return "empty";
  if (minStock > 0 && stock <= minStock) return "low";
  return "ok";
}

export default function AdminPage() {
  const [authState, setAuthState] = useState({
    loggedIn: false,
    isAdmin: false,
    status: "Verificando sessao...",
    name: "",
    email: "",
    showDenied: false,
  });
  const [products, setProducts] = useState([]);
  const [formData, setFormData] = useState(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageFeedback, setImageFeedback] = useState("");
  const [editingProductId, setEditingProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let unsubscribeAccess = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      unsubscribeAccess();
      setProducts([]);
      setProductsLoading(false);

      if (!user) {
        setAuthState({
          loggedIn: false,
          isAdmin: false,
          status: "Entre com Google para continuar.",
          name: "",
          email: "",
          showDenied: false,
        });
        return;
      }

      setAuthState({
        loggedIn: true,
        isAdmin: false,
        status: "Validando permissoes de admin...",
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
          status: "Nao foi possivel validar o acesso agora.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: true,
        });
        return;
      }

      unsubscribeAccess = subscribeToUserAccess(user, (access) => {
        const isBlocked = access.disabled;
        const allowed = access.canAccessAdminPanel;

        setAuthState({
          loggedIn: true,
          isAdmin: allowed,
          status: isBlocked
            ? "Essa conta foi desativada no painel."
            : allowed
              ? "Acesso liberado."
              : "Conta registrada. Agora e so marcar isAdmin como true em users no Firestore para liberar o painel.",
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

  const productCategories = useMemo(
    () =>
      Array.from(
        new Set(products.map((product) => product.category).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products]
  );

  const productStats = useMemo(() => {
    const trackedProducts = products.filter(productTracksStock);

    return {
      total: products.length,
      available: products.filter((product) => product.available !== false).length,
      unavailable: products.filter((product) => product.available === false).length,
      lowStock: trackedProducts.filter(
        (product) => getProductInventoryStatus(product) === "low"
      ).length,
      emptyStock: trackedProducts.filter(
        (product) => getProductInventoryStatus(product) === "empty"
      ).length,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const search = productSearch.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !search ||
        [product.title, product.category, product.details]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
      const inventoryStatus = getProductInventoryStatus(product);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "available" && product.available !== false) ||
        (statusFilter === "unavailable" && product.available === false) ||
        (statusFilter === "stockLow" && inventoryStatus === "low") ||
        (statusFilter === "stockEmpty" && inventoryStatus === "empty");

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, productSearch, products, statusFilter]);

  function handleFieldChange(event) {
    const { name, type, checked, value } = event.target;
    if (name === "image") {
      setImageFeedback("");
    }
    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageFeedback("Escolha um arquivo de imagem valido.");
      return;
    }

    setImageProcessing(true);
    setImageFeedback("Preparando foto...");

    try {
      const optimizedImage = await optimizeImageFile(file);
      setFormData((current) => ({
        ...current,
        image: optimizedImage,
      }));
      setImageFeedback("Foto carregada com sucesso.");
    } catch (error) {
      console.error(error);
      setImageFeedback(error.message || "Nao foi possivel carregar essa foto.");
    } finally {
      setImageProcessing(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!authState.isAdmin) {
      window.alert("Faca login com uma conta admin para salvar produtos.");
      return;
    }

    const product = {
      title: formData.title.trim(),
      category: formData.category.trim(),
      price: formData.price.trim(),
      image: formData.image.trim(),
      details: formData.details.trim(),
      subProducts: parseSubProductsText(formData.subProductsText),
      available: Boolean(formData.available),
      trackStock: Boolean(formData.trackStock),
      stock: normalizeStockNumber(formData.stock, 0),
      minStock: normalizeStockNumber(formData.minStock, 0),
    };

    if (!product.title || !product.category || !product.price) {
      window.alert("Preencha nome, categoria e preco.");
      return;
    }

    setSubmitting(true);

    try {
      if (editingProductId) {
        const previousProduct = products.find((item) => item.id === editingProductId) || {};
        await updateProductWithStockMovement({
          db,
          productId: editingProductId,
          product,
          previousProduct,
          actor: {
            name: authState.name,
            email: authState.email,
          },
        });
      } else {
        await addDoc(productsCollection, {
          ...product,
          createdAt: serverTimestamp(),
        });
      }

      setFormData(initialFormState);
      setImageFeedback("");
      setEditingProductId("");
    } catch (error) {
      console.error(error);
      if (error?.code === "permission-denied") {
        const isUploadedImage =
          typeof product.image === "string" && product.image.startsWith("data:image/");

        window.alert(
          isUploadedImage
            ? "Nao foi possivel salvar a foto deste produto. Publique as rules mais recentes do Firestore e, se precisar, tente uma imagem menor."
            : "Nao foi possivel salvar o produto porque a gravacao foi bloqueada pelas rules do Firestore. Confira se as rules mais recentes foram publicadas."
        );
      } else {
        window.alert("Nao foi possivel salvar o produto. Tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (window.location.protocol === "file:") {
      setAuthState((current) => ({
        ...current,
        status:
          "Abra o admin por localhost ou Firebase Hosting. Login Google nao funciona via arquivo local.",
      }));
      return;
    }

    setSigningIn(true);
    setAuthState((current) => ({
      ...current,
      status: "Abrindo login do Google...",
    }));

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error(error);
      setAuthState((current) => ({
        ...current,
        status: describeAdminAuthError(error),
      }));
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
      window.alert("Nao foi possivel sair agora.");
    }
  }

  async function toggleProductAvailability(product) {
    if (!authState.isAdmin) return;

    try {
      const productRef = doc(db, "products", product.id);
      await updateDoc(productRef, {
        available: !product.available,
      });
    } catch (error) {
      console.error(error);
      window.alert("Nao foi possivel atualizar este produto.");
    }
  }

  async function deleteProduct(product) {
    if (!authState.isAdmin) return;
    if (!window.confirm(`Excluir "${product.title}"? Essa acao nao pode ser desfeita.`)) return;

    try {
      const productRef = doc(db, "products", product.id);
      await deleteDoc(productRef);

      if (editingProductId === product.id) {
        setEditingProductId("");
        setFormData(initialFormState);
        setImageFeedback("");
      }
    } catch (error) {
      console.error(error);
      window.alert("Nao foi possivel excluir este produto.");
    }
  }

  function handleEditProduct(product) {
    setEditingProductId(product.id);
    setFormData(buildFormStateFromProduct(product));
    setImageFeedback("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function handleCancelEdit() {
    setEditingProductId("");
    setFormData(initialFormState);
    setImageFeedback("");
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Painel Admin</h1>
        <p>Cadastre itens do cardapio e controle disponibilidade com login Google.</p>

        <div className="admin-shortcuts">
          <Link className="secondary-button" href="/">
            Ver cardapio
          </Link>
          <Link className="secondary-button" href="/caixa">
            Abrir caixa
          </Link>
        </div>

        {authState.loggedIn ? (
          <div className="admin-session">
            <div>
              <strong>{authState.name}</strong>
              <small>{authState.email}</small>
            </div>
            <button type="button" className="secondary-button" onClick={handleSignOut}>
              Sair
            </button>
          </div>
        ) : null}
      </header>

      {!authState.loggedIn || !authState.isAdmin ? (
        <section className="auth-card">
          <p className="eyebrow">Acesso seguro</p>
          <h2>Entrar com Google</h2>
          <p className="auth-copy">
            Faca login com a conta Google autorizada no Firebase. Somente usuarios marcados como
            admin podem acessar este painel.
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
          <p className="eyebrow">Acesso negado</p>
          <h2>Conta sem permissao de admin</h2>
          <p className="auth-copy">
            Essa conta Google e registrada automaticamente na colecao <code>users</code>. Depois
            disso, basta mudar o campo <code>isAdmin</code> para <code>true</code> no Firestore.
          </p>
        </section>
      ) : null}

      {authState.loggedIn && authState.isAdmin ? (
        <div className="admin-shell">
          <div className="status-banner">{authState.status}</div>

          <section className="admin-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Cadastro de produtos</p>
                <h2>{editingProductId ? "Editar produto" : "Novo produto"}</h2>
              </div>
              {editingProductId ? (
                <button type="button" className="secondary-button" onClick={handleCancelEdit}>
                  Cancelar edicao
                </button>
              ) : null}
            </div>

            {editingProductId ? (
              <div className="admin-edit-banner">
                Editando: {formData.title || "produto selecionado"}
              </div>
            ) : null}

            <form className="admin-product-form" onSubmit={handleSubmit}>
              <div className="admin-form-column">
                <fieldset className="admin-form-section">
                  <legend>Informacoes basicas</legend>

                  <div className="admin-form-grid">
                    <label>
                      Nome do produto
                      <input
                        type="text"
                        name="title"
                        required
                        value={formData.title}
                        onChange={handleFieldChange}
                      />
                    </label>

                    <label>
                      Categoria
                      <select
                        name="category"
                        required
                        value={formData.category}
                        onChange={handleFieldChange}
                      >
                        <option value="">Selecione</option>
                        <option value="Bolos Tradicionais">Bolos Tradicionais</option>
                        <option value="Bolos Especiais">Bolos Especiais</option>
                        <option value="Fatias">Fatias</option>
                        <option value="Doces">Doces</option>
                        <option value="Sobremesas">Sobremesas</option>
                        <option value="Bebidas">Bebidas</option>
                      </select>
                    </label>

                    <label>
                      Preco
                      <input
                        type="text"
                        name="price"
                        required
                        placeholder="25.90"
                        value={formData.price}
                        onChange={handleFieldChange}
                      />
                    </label>

                    <label className="admin-toggle-card">
                      <input
                        type="checkbox"
                        name="available"
                        checked={formData.available}
                        onChange={handleFieldChange}
                      />
                      <span>Disponivel no cardapio</span>
                    </label>
                  </div>

                  <label>
                    Descricao
                    <textarea
                      name="details"
                      rows="3"
                      value={formData.details}
                      onChange={handleFieldChange}
                    />
                  </label>
                </fieldset>

                <fieldset className="admin-form-section">
                  <legend>Variacoes</legend>
                  <label>
                    Opcoes do produto
                    <textarea
                      name="subProductsText"
                      rows="4"
                      placeholder="Uma opcao por linha"
                      value={formData.subProductsText}
                      onChange={handleFieldChange}
                    />
                    <small className="field-help">
                      Use uma linha para cada sabor ou tamanho. Limite de 20 opcoes.
                    </small>
                  </label>
                </fieldset>
              </div>

              <div className="admin-form-column">
                <fieldset className="admin-form-section">
                  <legend>Foto</legend>

                  {formData.image ? (
                    <div
                      className="admin-image-preview admin-image-preview-compact"
                      style={{
                        backgroundImage: `url("${formData.image}")`,
                      }}
                    />
                  ) : (
                    <div className="admin-image-placeholder admin-image-preview-compact">
                      Previa da foto
                    </div>
                  )}

                  <label>
                    URL da foto
                    <input
                      type="text"
                      name="image"
                      placeholder="Cole uma URL"
                      value={formData.image}
                      onChange={handleFieldChange}
                    />
                  </label>

                  <label>
                    Enviar foto
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                    />
                  </label>

                  <div className="admin-image-actions">
                    {imageFeedback ? <p className="admin-image-feedback">{imageFeedback}</p> : null}
                    {formData.image ? (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setFormData((current) => ({ ...current, image: "" }));
                          setImageFeedback("");
                        }}
                        disabled={imageProcessing}
                      >
                        Remover foto
                      </button>
                    ) : null}
                  </div>
                </fieldset>

                <fieldset className="admin-form-section">
                  <legend>Estoque</legend>

                  <label className="admin-toggle-card">
                    <input
                      type="checkbox"
                      name="trackStock"
                      checked={formData.trackStock}
                      onChange={handleFieldChange}
                    />
                    <span>Controlar estoque deste produto</span>
                  </label>

                  {formData.trackStock ? (
                    <div className="admin-form-grid">
                      <label>
                        Quantidade
                        <input
                          type="number"
                          name="stock"
                          min="0"
                          step="1"
                          value={formData.stock}
                          onChange={handleFieldChange}
                        />
                      </label>

                      <label>
                        Alerta baixo
                        <input
                          type="number"
                          name="minStock"
                          min="0"
                          step="1"
                          value={formData.minStock}
                          onChange={handleFieldChange}
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="admin-form-muted">Estoque livre para venda no cardapio.</p>
                  )}
                </fieldset>

                <div className="admin-form-actions">
                  {editingProductId ? (
                    <button type="button" className="secondary-button" onClick={handleCancelEdit}>
                      Cancelar
                    </button>
                  ) : null}
                  <button className="primary-button" type="submit" disabled={submitting}>
                    {submitting
                      ? "Salvando..."
                      : editingProductId
                        ? "Salvar alteracoes"
                        : "Salvar produto"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="admin-card admin-products-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Produtos cadastrados</p>
                <h2>Gerenciar produtos</h2>
              </div>
              <span className="pill">
                {productsLoading ? "Atualizando..." : `${filteredProducts.length}/${products.length} produtos`}
              </span>
            </div>

            <div className="admin-summary-grid">
              <article className="admin-summary-card">
                <span>Total</span>
                <strong>{productStats.total}</strong>
              </article>
              <article className="admin-summary-card">
                <span>Disponiveis</span>
                <strong>{productStats.available}</strong>
              </article>
              <article className="admin-summary-card">
                <span>Indisponiveis</span>
                <strong>{productStats.unavailable}</strong>
              </article>
              <article className="admin-summary-card">
                <span>Atencao no estoque</span>
                <strong>{productStats.lowStock + productStats.emptyStock}</strong>
              </article>
            </div>

            <div className="admin-product-toolbar">
              <label>
                Buscar
                <input
                  type="search"
                  placeholder="Nome, categoria ou descricao"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
              </label>

              <label>
                Categoria
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">Todas</option>
                  {productCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">Todos</option>
                  <option value="available">Disponiveis</option>
                  <option value="unavailable">Indisponiveis</option>
                  <option value="stockLow">Estoque baixo</option>
                  <option value="stockEmpty">Sem estoque</option>
                </select>
              </label>
            </div>

            {productsLoading ? <div className="page-message">Carregando produtos...</div> : null}

            {!productsLoading && products.length === 0 ? (
              <div className="empty-state">Nenhum produto cadastrado ainda.</div>
            ) : null}

            {!productsLoading && products.length > 0 && filteredProducts.length === 0 ? (
              <div className="empty-state">Nenhum produto encontrado com esses filtros.</div>
            ) : null}

            <div className="admin-product-list">
              {filteredProducts.map((product) => {
                const inventoryStatus = getProductInventoryStatus(product);
                const stockTone =
                  inventoryStatus === "empty"
                    ? " danger"
                    : inventoryStatus === "low"
                      ? " warning"
                      : "";

                return (
                  <article className="admin-product-row" key={product.id}>
                    <div
                      className="admin-product-thumb"
                      style={
                        product.image
                          ? {
                              backgroundImage: `url("${product.image}")`,
                            }
                          : undefined
                      }
                    />

                    <div className="admin-product-main">
                      <strong>{product.title}</strong>
                      <span>{product.category}</span>
                    </div>

                    <strong className="admin-product-price">
                      {formatDisplayPrice(product.price)}
                    </strong>

                    <span className={`admin-status-chip${product.available === false ? " muted" : ""}`}>
                      {product.available === false ? "Indisponivel" : "Disponivel"}
                    </span>

                    <span className={`admin-status-chip${stockTone}`}>
                      {getProductStockText(product)}
                    </span>

                    <div className="admin-product-actions">
                      <button type="button" onClick={() => handleEditProduct(product)}>
                        Editar
                      </button>
                      <button type="button" onClick={() => toggleProductAvailability(product)}>
                        {product.available !== false ? "Pausar" : "Ativar"}
                      </button>
                      <button type="button" onClick={() => deleteProduct(product)}>
                        Excluir
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
