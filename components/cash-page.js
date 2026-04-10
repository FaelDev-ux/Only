"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, db, googleProvider } from "../lib/firebase";
import {
  buildGroupedProducts,
  describeAdminAuthError,
  formatDisplayPrice,
  formatPrice,
  getAdminDocId,
  parsePrice,
} from "../lib/store-utils";

const productsCollection = collection(db, "products");
const ordersCollection = collection(db, "orders");
const cashSalesCollection = collection(db, "cashSales");

const initialSaleForm = {
  customerName: "",
  payment: "pix",
  notes: "",
};

function getDocDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
}

function isToday(value) {
  const date = getDocDate(value);
  if (!date) return false;

  const now = new Date();

  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function formatDateTime(value) {
  const date = getDocDate(value);
  if (!date) return "Agora mesmo";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
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

function buildPickerProduct(product) {
  return {
    id: product?.id || "",
    title: product?.title || "",
    price: formatDisplayPrice(product?.price || ""),
    image: product?.image || "",
    details: product?.details || "",
    subProducts: normalizeSubProducts(product?.subProducts),
    selectedSubProduct: "",
  };
}

function buildSaleItem(product, selectedSubProduct = "") {
  const option = selectedSubProduct.trim();

  return {
    title: option ? `${product.title} - ${option}` : product.title,
    price: product.price,
    image: product.image || "",
    qty: 1,
  };
}

async function ensureAdminProfile(user) {
  const adminDocId = getAdminDocId(user);
  if (!adminDocId) return;

  const adminRef = doc(db, "adminUsers", adminDocId);
  const adminSnap = await getDoc(adminRef);

  if (!adminSnap.exists()) {
    await setDoc(adminRef, {
      email: adminDocId,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      isAdmin: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    return;
  }

  await setDoc(
    adminRef,
    {
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function isAllowedAdmin(user) {
  const adminDocId = getAdminDocId(user);
  if (!adminDocId) return false;

  const adminRef = doc(db, "adminUsers", adminDocId);
  const adminSnap = await getDoc(adminRef);
  const data = adminSnap.data() || {};

  return adminSnap.exists() && (data.isAdmin === true || data.active === true);
}

export default function CashPage() {
  const [authState, setAuthState] = useState({
    loggedIn: false,
    isAdmin: false,
    status: "Verificando sessão...",
    name: "",
    email: "",
    showDenied: false,
  });
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cashSales, setCashSales] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [saleForm, setSaleForm] = useState(initialSaleForm);
  const [saleCart, setSaleCart] = useState([]);
  const [pickerProduct, setPickerProduct] = useState(null);
  const [submittingSale, setSubmittingSale] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setProducts([]);
      setOrders([]);
      setCashSales([]);

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
        status: "Validando permissões do caixa...",
        name: user.displayName || "Conta Google",
        email: user.email || "",
        showDenied: false,
      });

      try {
        await ensureAdminProfile(user);
        const allowed = await isAllowedAdmin(user);

        if (!allowed) {
          setAuthState({
            loggedIn: true,
            isAdmin: false,
            status: "Essa conta ainda não foi liberada para o caixa.",
            name: user.displayName || "Conta Google",
            email: user.email || "",
            showDenied: true,
          });
          return;
        }

        setAuthState({
          loggedIn: true,
          isAdmin: true,
          status: "Caixa pronto para uso.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: false,
        });
      } catch (error) {
        console.error(error);
        setAuthState({
          loggedIn: true,
          isAdmin: false,
          status: "Não foi possível validar o acesso ao caixa agora.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: true,
        });
      }
    });

    return unsubscribeAuth;
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
          .sort((a, b) => (getDocDate(b.createdAt)?.getTime() || 0) - (getDocDate(a.createdAt)?.getTime() || 0));

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
          .sort((a, b) => (getDocDate(b.createdAt)?.getTime() || 0) - (getDocDate(a.createdAt)?.getTime() || 0));

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

  const groupedProducts = useMemo(() => buildGroupedProducts(products), [products]);
  const todayOrders = useMemo(() => orders.filter((item) => isToday(item.createdAt)), [orders]);
  const todayCashSales = useMemo(
    () => cashSales.filter((item) => isToday(item.createdAt)),
    [cashSales]
  );
  const onlineTotal = todayOrders.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const cashTotal = todayCashSales.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const saleCartTotal = saleCart.reduce((sum, item) => sum + parsePrice(item.price) * item.qty, 0);

  function addItemToSale(item) {
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
    const nextProduct = buildPickerProduct(product);

    if (nextProduct.subProducts.length > 0) {
      setPickerProduct(nextProduct);
      return;
    }

    addItemToSale(buildSaleItem(nextProduct));
  }

  function updateSaleQty(title, delta) {
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
      setNoticeMessage("Não foi possível sair do caixa agora.");
    }
  }

  async function handleFinishSale() {
    if (saleCart.length === 0) {
      setNoticeMessage("Adicione ao menos um item antes de fechar a venda.");
      return;
    }

    setSubmittingSale(true);

    try {
      const items = saleCart.map((item) => ({
        title: item.title,
        price: item.price,
        qty: item.qty,
        image: item.image || "",
      }));

      await addDoc(cashSalesCollection, {
        items,
        total: saleCartTotal,
        payment: saleForm.payment,
        customerName: saleForm.customerName.trim(),
        notes: saleForm.notes.trim(),
        source: "caixa",
        createdAt: serverTimestamp(),
      });

      setSaleCart([]);
      setSaleForm(initialSaleForm);
      setNoticeMessage("Venda registrada no caixa com sucesso.");
    } catch (error) {
      console.error(error);
      setNoticeMessage("Não foi possível registrar essa venda agora.");
    } finally {
      setSubmittingSale(false);
    }
  }

  return (
    <div className="cash-page">
      <header className="cash-header admin-card">
        <div className="cash-brand">
          <div className="cash-logo-wrap">
            <img src="/logo.jpeg" alt="Logo Bolo de Mãe JP Confeitaria" />
          </div>

          <div>
            <p className="eyebrow">Operação interna</p>
            <h1>Sistema de Caixa</h1>
            <p className="cash-copy">
              Caixa ligado ao cardápio, lendo os mesmos produtos e acompanhando os pedidos da loja.
            </p>
          </div>
        </div>

        <div className="cash-top-actions">
          <Link className="secondary-button" href="/">
            Ver cardápio
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
          <p className="eyebrow">Sem permissão</p>
          <h2>Conta ainda não liberada</h2>
          <p className="auth-copy">
            A conta entrou com sucesso, mas ainda precisa estar marcada como admin no Firestore
            para operar o caixa.
          </p>
        </section>
      ) : null}

      {authState.loggedIn && authState.isAdmin ? (
        <div className="cash-shell">
          <div className="status-banner">{authState.status}</div>

          <section className="summary-grid">
            <article className="summary-card">
              <span className="summary-label">Pedidos do cardápio hoje</span>
              <strong>{todayOrders.length}</strong>
              <small>{formatPrice(onlineTotal)}</small>
            </article>

            <article className="summary-card">
              <span className="summary-label">Vendas do caixa hoje</span>
              <strong>{todayCashSales.length}</strong>
              <small>{formatPrice(cashTotal)}</small>
            </article>

            <article className="summary-card">
              <span className="summary-label">Movimento total do dia</span>
              <strong>{todayOrders.length + todayCashSales.length}</strong>
              <small>{formatPrice(onlineTotal + cashTotal)}</small>
            </article>
          </section>

          <div className="cash-layout">
            <section className="admin-card sales-builder">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Venda manual</p>
                  <h2>Frente de caixa</h2>
                </div>
                <span className="pill">{productsLoading ? "Carregando produtos..." : `${products.length} itens`}</span>
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
                    <option value="cartão">Cartão</option>
                  </select>
                </label>

                <label className="full">
                  Observações
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
                      {categoryProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="cash-product-button"
                          onClick={() => handleAddProduct(product)}
                        >
                          <span>{product.title}</span>
                          <strong>{formatDisplayPrice(product.price)}</strong>
                          {Array.isArray(product.subProducts) && product.subProducts.length > 0 ? (
                            <small>{product.subProducts.length} opções</small>
                          ) : (
                            <small>Adicionar direto</small>
                          )}
                        </button>
                      ))}
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
                <span>Total da venda</span>
                <strong>{formatPrice(saleCartTotal)}</strong>
              </div>

              <button
                type="button"
                className="modal-add"
                onClick={handleFinishSale}
                disabled={submittingSale}
              >
                {submittingSale ? "Registrando..." : "Fechar venda no caixa"}
              </button>
            </section>
          </div>

          <div className="cash-layout">
            <section className="admin-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Integração com o cardápio</p>
                  <h2>Pedidos recebidos hoje</h2>
                </div>
                <span className="pill">{ordersLoading ? "Atualizando..." : `${todayOrders.length} pedidos`}</span>
              </div>

              {todayOrders.length === 0 ? (
                <div className="empty-state">
                  Nenhum pedido novo do cardápio entrou hoje até agora.
                </div>
              ) : (
                <div className="order-list">
                  {todayOrders.slice(0, 10).map((order) => (
                    <article className="order-card" key={order.id}>
                      <div className="order-card-top">
                        <strong>{order.customer?.name || "Cliente"}</strong>
                        <span>{formatDateTime(order.createdAt)}</span>
                      </div>
                      <small>
                        {order.items?.length || 0} itens • {order.customer?.payment || "Pagamento não informado"}
                      </small>
                      <p className="order-card-lines">
                        {(order.items || [])
                          .map((item) => `${item.qty}x ${item.title}`)
                          .join(" • ")}
                      </p>
                      <div className="order-card-bottom">
                        <span>{order.customer?.phone || "Sem telefone"}</span>
                        <strong>{formatPrice(Number(order.total || 0))}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="admin-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Resumo interno</p>
                  <h2>Vendas lançadas no caixa</h2>
                </div>
                <span className="pill">{salesLoading ? "Atualizando..." : `${todayCashSales.length} vendas`}</span>
              </div>

              {todayCashSales.length === 0 ? (
                <div className="empty-state">Nenhuma venda manual registrada hoje.</div>
              ) : (
                <div className="order-list">
                  {todayCashSales.slice(0, 10).map((sale) => (
                    <article className="order-card" key={sale.id}>
                      <div className="order-card-top">
                        <strong>{sale.customerName || "Venda balcão"}</strong>
                        <span>{formatDateTime(sale.createdAt)}</span>
                      </div>
                      <small>{sale.payment || "Pagamento não informado"}</small>
                      <p className="order-card-lines">
                        {(sale.items || [])
                          .map((item) => `${item.qty}x ${item.title}`)
                          .join(" • ")}
                      </p>
                      <div className="order-card-bottom">
                        <span>{sale.notes || "Sem observações"}</span>
                        <strong>{formatPrice(Number(sale.total || 0))}</strong>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
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
              ×
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
              <p className="modal-details">
                Escolha a variação para lançar esse produto no caixa.
              </p>

              <div className="modal-options">
                <p className="modal-options-label">Opções disponíveis</p>
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
                          current
                            ? {
                                ...current,
                                selectedSubProduct: subProduct,
                              }
                            : current
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
                : "Escolha uma opção"}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`modal${noticeMessage ? " is-open" : ""}`}
        aria-hidden={noticeMessage ? "false" : "true"}
      >
        <div className="modal-backdrop" onClick={() => setNoticeMessage("")} />
        {noticeMessage ? (
          <div className="modal-card notice-card" role="dialog" aria-modal="true" aria-labelledby="cash-notice-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setNoticeMessage("")}
            >
              ×
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
