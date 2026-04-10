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
  updateDoc,
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
const cashSessionsCollection = collection(db, "cashSessions");

const initialSaleForm = {
  customerName: "",
  payment: "pix",
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
  const [openingAmountText, setOpeningAmountText] = useState("0,00");
  const [submittingSale, setSubmittingSale] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
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
        await ensureAdminProfile(user);
        const allowed = await isAllowedAdmin(user);

        if (!allowed) {
          setAuthState({
            loggedIn: true,
            isAdmin: false,
            status: "Essa conta ainda nao foi liberada para o caixa.",
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
          status: "Nao foi possivel validar o acesso ao caixa agora.",
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
  const recentSessions = useMemo(() => cashSessions.slice(0, 6), [cashSessions]);
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
    if (!activeSession) {
      setNoticeMessage("Abra o caixa antes de lancar vendas presenciais.");
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
        title: item.title,
        price: item.price,
        qty: item.qty,
        image: item.image || "",
      }));

      await addDoc(cashSalesCollection, {
        sessionId: activeSession.id,
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
      setNoticeMessage("Nao foi possivel registrar essa venda agora.");
    } finally {
      setSubmittingSale(false);
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
                            <small>{product.subProducts.length} opcoes</small>
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
                disabled={submittingSale || !activeSession}
              >
                {submittingSale ? "Registrando..." : "Fechar venda no caixa"}
              </button>
            </section>
          </div>

          <div className="cash-layout">
            <section className="admin-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Integracao com o cardapio</p>
                  <h2>Pedidos da sessao</h2>
                </div>
                <span className="pill">
                  {ordersLoading ? "Atualizando..." : `${sessionOrders.length} pedidos`}
                </span>
              </div>

              {sessionOrders.length === 0 ? (
                <div className="empty-state">
                  Nenhum pedido do cardapio entrou durante a sessao atual.
                </div>
              ) : (
                <div className="order-list">
                  {sessionOrders.slice(0, 10).map((order) => (
                    <article className="order-card" key={order.id}>
                      <div className="order-card-top">
                        <strong>{order.customer?.name || "Cliente"}</strong>
                        <span>{formatDateTime(order.createdAt)}</span>
                      </div>
                      <small>
                        {order.items?.length || 0} itens - {order.customer?.payment || "Sem pagamento"}
                      </small>
                      <p className="order-card-lines">
                        {(order.items || []).map((item) => `${item.qty}x ${item.title}`).join(" - ")}
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
                  <p className="eyebrow">Historico do caixa</p>
                  <h2>Quem abriu e fechou</h2>
                </div>
                <span className="pill">
                  {sessionsLoading ? "Atualizando..." : `${recentSessions.length} sessoes`}
                </span>
              </div>

              {recentSessions.length === 0 ? (
                <div className="empty-state">Nenhuma sessao registrada ainda.</div>
              ) : (
                <div className="order-list">
                  {recentSessions.map((session) => (
                    <article className="order-card" key={session.id}>
                      <div className="order-card-top">
                        <strong>{session.status === "open" ? "Caixa aberto" : "Caixa fechado"}</strong>
                        <span>{formatDateTime(session.openedAt)}</span>
                      </div>
                      <small>
                        Aberto por {session.openedByName || "Admin"} - {session.openedByEmail || "Sem email"}
                      </small>
                      <p className="order-card-lines">
                        Valor inicial: {formatPrice(Number(session.openingAmount || 0))}
                        {session.status === "closed"
                          ? ` | Saldo esperado: ${formatPrice(Number(session.expectedClosingBalance || 0))}`
                          : " | Sessao ainda em andamento"}
                      </p>
                      <div className="order-card-bottom">
                        <span>
                          {session.closedByName
                            ? `Fechado por ${session.closedByName}`
                            : "Ainda sem fechamento"}
                        </span>
                        <strong>{session.closedAt ? formatDateTime(session.closedAt) : "Aberto agora"}</strong>
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
