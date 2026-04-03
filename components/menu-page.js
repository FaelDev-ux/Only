"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, db, googleProvider } from "../lib/firebase";
import {
  SEND_TO_CUSTOMER,
  STORE_WHATSAPP,
  buildGroupedProducts,
  describePublicAuthError,
  fetchViaCEP,
  formatDisplayPrice,
  formatPrice,
  getAdminDocId,
  isValidCEP,
  isValidPhone,
  maskCEP,
  maskPhone,
  onlyDigits,
  parsePrice,
} from "../lib/store-utils";

const ordersCollection = collection(db, "orders");
const productsCollection = collection(db, "products");

const initialCheckoutState = {
  name: "",
  phone: "",
  payment: "",
  cep: "",
  address: "",
  district: "",
  complement: "",
  notes: "",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.8-2.7-5.8-6s2.6-6 5.8-6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.6 3.4 14.5 2.5 12 2.5c-5.2 0-9.5 4.2-9.5 9.5s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z"
      />
      <path
        fill="#FBBC05"
        d="M3.6 7.6l3.2 2.4C7.7 7.7 9.7 6 12 6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.6 3.4 14.5 2.5 12 2.5c-3.7 0-6.9 2.1-8.4 5.1z"
      />
      <path
        fill="#34A853"
        d="M12 21.5c2.4 0 4.5-.8 6-2.3l-2.8-2.2c-.8.6-1.9 1-3.2 1-3.9 0-5.2-2.6-5.4-3.9l-3.1 2.4c1.5 3 4.7 5 8.5 5z"
      />
      <path
        fill="#4285F4"
        d="M3.6 16.5l3.1-2.4c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6L3.6 8.5c-.7 1.3-1.1 2.6-1.1 4s.4 2.7 1.1 4z"
      />
    </svg>
  );
}

export default function MenuPage() {
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [modalProduct, setModalProduct] = useState(null);
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutData, setCheckoutData] = useState(initialCheckoutState);
  const [authFeedbackMessage, setAuthFeedbackMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [authState, setAuthState] = useState({
    loggedIn: false,
    name: "",
    isAdmin: false,
  });
  const toastTimeoutRef = useRef(null);

  useEffect(() => {
    const publicProductsQuery = query(productsCollection, where("available", "==", true));

    const unsubscribe = onSnapshot(
      publicProductsQuery,
      (snapshot) => {
        setProducts(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
        setProductsLoading(false);
      },
      (error) => {
        console.error(error);
        setProducts([]);
        setProductsLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthState({
          loggedIn: false,
          name: "",
          isAdmin: false,
        });
        return;
      }

      const firstName = (user.displayName || user.email || "Conta Google").split(" ")[0];

      try {
        const adminDocId = getAdminDocId(user);
        let isAdmin = false;

        if (adminDocId) {
          const adminRef = doc(db, "adminUsers", adminDocId);
          const adminSnap = await getDoc(adminRef);
          const data = adminSnap.data() || {};
          isAdmin = adminSnap.exists() && (data.isAdmin === true || data.active === true);
        }

        setAuthState({
          loggedIn: true,
          name: firstName,
          isAdmin,
        });
      } catch (error) {
        console.error(error);
        setAuthState({
          loggedIn: true,
          name: firstName,
          isAdmin: false,
        });
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!modalProduct && !isCheckoutOpen && !authFeedbackMessage) return undefined;

    function handleEscape(event) {
      if (event.key !== "Escape") return;
      setModalProduct(null);
      setIsCheckoutOpen(false);
      setAuthFeedbackMessage("");
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [authFeedbackMessage, isCheckoutOpen, modalProduct]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const shouldLockScroll = isCartOpen || isCheckoutOpen;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;

    if (shouldLockScroll) {
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [isCartOpen, isCheckoutOpen]);

  const groupedProducts = buildGroupedProducts(products);
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const cartTotal = cart.reduce((sum, item) => sum + parsePrice(item.price) * item.qty, 0);

  function showCartToast(message) {
    setToastMessage(message);

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage("");
    }, 2000);
  }

  function addToCart(item) {
    if (!item?.title) return;

    setCart((currentCart) => {
      const existing = currentCart.find((entry) => entry.title === item.title);

      if (existing) {
        return currentCart.map((entry) =>
          entry.title === item.title ? { ...entry, qty: entry.qty + 1 } : entry
        );
      }

      return [...currentCart, { ...item, qty: 1 }];
    });

    showCartToast(`${item.title} foi adicionado ao carrinho.`);
  }

  function updateQty(title, delta) {
    setCart((currentCart) =>
      currentCart
        .map((item) => (item.title === title ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0)
    );
  }

  async function handleGoogleSignIn() {
    if (window.location.protocol === "file:") {
      setAuthFeedbackMessage("Não foi possível abrir o login neste momento.");
      return;
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error(error);
      setAuthFeedbackMessage(describePublicAuthError(error));
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
      window.alert("Não foi possível sair agora.");
    }
  }

  function handleCheckoutFieldChange(event) {
    const { name, value } = event.target;

    setCheckoutData((current) => {
      if (name === "phone") {
        return { ...current, [name]: maskPhone(value) };
      }

      if (name === "cep") {
        return { ...current, [name]: maskCEP(value) };
      }

      return { ...current, [name]: value };
    });
  }

  async function handleCepBlur() {
    if (!isValidCEP(checkoutData.cep)) return;

    const data = await fetchViaCEP(checkoutData.cep);
    if (!data) return;

    setCheckoutData((current) => ({
      ...current,
      address: current.address || data.logradouro || "",
      district: current.district || data.bairro || "",
    }));
  }

  async function handleCheckoutSubmit(event) {
    event.preventDefault();

    if (cart.length === 0) {
      setAuthFeedbackMessage("Seu carrinho está vazio no momento.");
      return;
    }

    const normalizedPhone = maskPhone(checkoutData.phone);
    const normalizedCep = maskCEP(checkoutData.cep);

    if (!isValidPhone(normalizedPhone)) {
      window.alert("Telefone/WhatsApp inválido. Use DDD + número.");
      return;
    }

    if (!isValidCEP(normalizedCep)) {
      window.alert("CEP inválido. Use 8 dígitos.");
      return;
    }

    setCheckoutSubmitting(true);

    try {
      const viaCepData = await fetchViaCEP(normalizedCep);

      if (!viaCepData) {
        window.alert("CEP não encontrado. Verifique e tente novamente.");
        return;
      }

      const items = cart.map((item) => ({
        title: item.title,
        price: item.price,
        qty: item.qty,
        image: item.image || "",
      }));

      const totalValue = items.reduce((sum, item) => sum + parsePrice(item.price) * item.qty, 0);

      const customer = {
        name: checkoutData.name.trim(),
        phone: normalizedPhone.trim(),
        payment: checkoutData.payment,
        cep: normalizedCep.trim(),
        address: checkoutData.address.trim() || viaCepData.logradouro || "",
        district: checkoutData.district.trim() || viaCepData.bairro || "",
        complement: checkoutData.complement.trim(),
        notes: checkoutData.notes.trim(),
        city: viaCepData.localidade || "",
        state: viaCepData.uf || "",
      };

      await addDoc(ordersCollection, {
        items,
        total: totalValue,
        customer,
        createdAt: serverTimestamp(),
      });

      const messageLines = [
        "Novo pedido - Bolo de Mãe JP Confeitaria",
        "",
        "Itens:",
        ...items.map((item) => `- ${item.qty}x ${item.title} (${item.price})`),
        "",
        `Total: ${formatPrice(totalValue)}`,
        "",
        "Cliente:",
        `Nome: ${customer.name}`,
        `WhatsApp: ${customer.phone}`,
        `Pagamento: ${customer.payment}`,
        `Endereço: ${customer.address}, ${customer.district} - CEP ${customer.cep}`,
        `Cidade/UF: ${customer.city} - ${customer.state}`,
        `Complemento: ${customer.complement || "-"}`,
        `Observações: ${customer.notes || "-"}`,
      ];

      if (STORE_WHATSAPP) {
        const text = encodeURIComponent(messageLines.join("\n"));
        const target = onlyDigits(STORE_WHATSAPP);
        window.open(`https://wa.me/${target}?text=${text}`, "_blank", "noopener,noreferrer");

        if (SEND_TO_CUSTOMER && customer.phone) {
          const customerTarget = onlyDigits(customer.phone);
          window.open(
            `https://wa.me/${customerTarget}?text=${text}`,
            "_blank",
            "noopener,noreferrer"
          );
        }
      } else {
        window.alert(
          "Pedido enviado com sucesso! Configure o número da loja em STORE_WHATSAPP para enviar no WhatsApp."
        );
      }

      setCart([]);
      setCheckoutData(initialCheckoutState);
      setIsCheckoutOpen(false);
      setIsCartOpen(false);
    } catch (error) {
      console.error(error);
      window.alert("Não foi possível enviar o pedido. Tente novamente.");
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  return (
    <>
      <div className="page">
        <header className="hero">
          <div className="hero-frame">
            <div className="cart-fab">
              {!authState.loggedIn ? (
                <button
                  className="auth-button"
                  type="button"
                  aria-label="Entrar com Google"
                  title="Entrar com Google"
                  onClick={handleGoogleSignIn}
                >
                  <GoogleIcon />
                </button>
              ) : null}

              {authState.loggedIn ? (
                <div className="user-chip">
                  <span className="user-chip-label">
                    {authState.name ? `Olá, ${authState.name}` : "Conta Google"}
                  </span>
                  <button className="user-chip-logout" type="button" onClick={handleSignOut}>
                    Sair
                  </button>
                </div>
              ) : null}

              {authState.loggedIn && authState.isAdmin ? (
                <Link className="manage-link" href="/admin">
                  Gerenciar produtos
                </Link>
              ) : null}

              <button className="cart-button" type="button" onClick={() => setIsCartOpen(true)}>
                <span>Carrinho</span>
                <span className="cart-count">{cartCount}</span>
              </button>
            </div>

            <div className="logo-wrap">
              <img src="/logo.jpeg" alt="Logo Bolo de Mãe JP Confeitaria" />
            </div>

            <div className="hero-text">
              <p className="brand">Bolo de Mãe JP Confeitaria</p>
              <h1>Cardápio</h1>
              <p className="subtitle">Delicadeza artesanal em cada fatia</p>
            </div>

            <div className="ornament ornament-left" aria-hidden="true" />
            <div className="ornament ornament-right" aria-hidden="true" />
          </div>
        </header>

        {productsLoading ? <div className="page-message">Carregando produtos...</div> : null}

        {!productsLoading && groupedProducts.length === 0 ? (
          <div className="empty-state">Nenhum produto disponível no momento.</div>
        ) : null}

        <main className="menu">
          {groupedProducts.map(({ category, products: categoryProducts }) => (
            <section className="menu-col" key={category}>
              <div className="card">
                <h2>{category}</h2>
                <ul className="item-grid">
                  {categoryProducts.map((product) => {
                    const priceText = formatDisplayPrice(product.price);
                    const image = product.image || "";

                    return (
                      <li className="menu-item" key={product.id}>
                        <button
                          className="item-button"
                          type="button"
                          onClick={() =>
                            setModalProduct({
                              title: product.title || "",
                              price: priceText,
                              details: product.details || "",
                              image,
                            })
                          }
                        >
                          <div
                            className={`item-photo${image ? " has-image" : ""}`}
                            data-label="Foto"
                            style={
                              image
                                ? {
                                    backgroundImage: `url("${image}")`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }
                                : undefined
                            }
                          />
                          <div className="item-info">
                            <span>{product.title}</span>
                            <span className="price">{priceText}</span>
                          </div>
                        </button>

                        <button
                          className="add-to-cart"
                          type="button"
                          onClick={() =>
                            addToCart({
                              title: product.title || "",
                              price: priceText,
                              image,
                            })
                          }
                        >
                          Adicionar ao carrinho
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
        </main>

        <footer className="footer">
          <div className="footer-line" />
          <p>Encomendas e detalhes pelo WhatsApp • @bolodemaejp</p>
        </footer>
      </div>

      <div className={`modal${modalProduct ? " is-open" : ""}`} aria-hidden={modalProduct ? "false" : "true"}>
        <div className="modal-backdrop" onClick={() => setModalProduct(null)} />
        {modalProduct ? (
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setModalProduct(null)}
            >
              ✕
            </button>
            <div
              className={`modal-photo${modalProduct.image ? " has-image" : ""}`}
              data-label="Foto"
              style={
                modalProduct.image
                  ? {
                      backgroundImage: `url("${modalProduct.image}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            />
            <div className="modal-content">
              <h3 id="modal-title">{modalProduct.title}</h3>
              <p className="modal-price">{modalProduct.price}</p>
              <p className="modal-details">{modalProduct.details}</p>
            </div>
            <button
              className="modal-add"
              type="button"
              onClick={() => {
                addToCart(modalProduct);
                setModalProduct(null);
              }}
            >
              Adicionar ao carrinho
            </button>
          </div>
        ) : null}
      </div>

      <aside className={`cart-panel${isCartOpen ? " is-open" : ""}`} aria-hidden={isCartOpen ? "false" : "true"}>
        <div className="cart-header">
          <h3>Seu carrinho</h3>
          <button className="cart-close" type="button" onClick={() => setIsCartOpen(false)}>
            Fechar
          </button>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <div className="empty-state">Seu carrinho está vazio.</div>
          ) : (
            cart.map((item) => (
              <div className="cart-item" key={item.title}>
                <div
                  className="cart-thumb"
                  style={item.image ? { backgroundImage: `url("${item.image}")` } : undefined}
                />
                <div>
                  <div className="cart-item-title">{item.title}</div>
                  <div className="cart-item-price">{item.price}</div>
                  <div className="cart-item-controls">
                    <button type="button" onClick={() => updateQty(item.title, -1)}>
                      -
                    </button>
                    <span>{item.qty}</span>
                    <button type="button" onClick={() => updateQty(item.title, 1)}>
                      +
                    </button>
                    <button
                      className="remove-button"
                      type="button"
                      onClick={() => updateQty(item.title, -item.qty)}
                    >
                      remover
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cart-footer">
          <div className="cart-total">
            <span>Total</span>
            <strong>{formatPrice(cartTotal)}</strong>
          </div>
          <button
            className="cart-checkout"
            type="button"
            onClick={() => {
                if (cart.length === 0) {
                  setIsCartOpen(false);
                  setAuthFeedbackMessage("Seu carrinho está vazio no momento.");
                  return;
                }

              setIsCartOpen(false);
              setIsCheckoutOpen(true);
            }}
          >
            Finalizar pedido
          </button>
        </div>
      </aside>

      <div
        className={`modal${isCheckoutOpen ? " is-open" : ""}`}
        aria-hidden={isCheckoutOpen ? "false" : "true"}
      >
        <div className="modal-backdrop" onClick={() => setIsCheckoutOpen(false)} />
        {isCheckoutOpen ? (
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setIsCheckoutOpen(false)}
            >
              ✕
            </button>
            <div className="modal-content">
              <h3 id="checkout-title">Finalizar pedido</h3>
              <p className="modal-details">Preencha seus dados para enviar o pedido.</p>
            </div>

            <form className="checkout-form" onSubmit={handleCheckoutSubmit}>
              <div className="form-grid">
                <label>
                  Nome completo
                  <input type="text" name="name" required value={checkoutData.name} onChange={handleCheckoutFieldChange} />
                </label>

                <label>
                  WhatsApp
                  <input type="text" name="phone" required value={checkoutData.phone} onChange={handleCheckoutFieldChange} />
                </label>

                <label>
                  Forma de pagamento
                  <select name="payment" required value={checkoutData.payment} onChange={handleCheckoutFieldChange}>
                    <option value="">Selecione</option>
                    <option value="cartão">Cartão</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="pix">Pix</option>
                  </select>
                </label>

                <label>
                  CEP
                  <input
                    type="text"
                    name="cep"
                    required
                    value={checkoutData.cep}
                    onChange={handleCheckoutFieldChange}
                    onBlur={handleCepBlur}
                  />
                </label>

                <label>
                  Endereço
                  <input type="text" name="address" required value={checkoutData.address} onChange={handleCheckoutFieldChange} />
                </label>

                <label>
                  Bairro
                  <input type="text" name="district" required value={checkoutData.district} onChange={handleCheckoutFieldChange} />
                </label>

                <label>
                  Complemento
                  <input type="text" name="complement" value={checkoutData.complement} onChange={handleCheckoutFieldChange} />
                </label>

                <label className="form-span-2">
                  Observações
                  <textarea name="notes" rows="3" value={checkoutData.notes} onChange={handleCheckoutFieldChange} />
                </label>
              </div>

              <button className="modal-add" type="submit" disabled={checkoutSubmitting}>
                {checkoutSubmitting ? "Enviando..." : "Enviar pedido"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      <div
        className={`modal${authFeedbackMessage ? " is-open" : ""}`}
        aria-hidden={authFeedbackMessage ? "false" : "true"}
      >
        <div className="modal-backdrop" onClick={() => setAuthFeedbackMessage("")} />
        {authFeedbackMessage ? (
          <div className="modal-card notice-card" role="dialog" aria-modal="true" aria-labelledby="auth-feedback-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Fechar"
              onClick={() => setAuthFeedbackMessage("")}
            >
              ✕
            </button>
            <div className="modal-content">
              <h3 id="auth-feedback-title">Aviso</h3>
              <p className="modal-details">{authFeedbackMessage}</p>
            </div>
            <button className="modal-add" type="button" onClick={() => setAuthFeedbackMessage("")}>
              Entendi
            </button>
          </div>
        ) : null}
      </div>

      <div className={`toast${toastMessage ? " is-visible" : ""}`} aria-live="polite" aria-atomic="true">
        {toastMessage}
      </div>
    </>
  );
}
