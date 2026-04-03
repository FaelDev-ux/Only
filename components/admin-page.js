"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
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
  describeAdminAuthError,
  formatDisplayPrice,
  getAdminDocId,
} from "../lib/store-utils";

const productsCollection = collection(db, "products");

const initialFormState = {
  title: "",
  category: "",
  price: "",
  image: "",
  details: "",
  available: true,
};

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

export default function AdminPage() {
  const [authState, setAuthState] = useState({
    loggedIn: false,
    isAdmin: false,
    status: "Verificando sessão...",
    name: "",
    email: "",
    showDenied: false,
  });
  const [products, setProducts] = useState([]);
  const [formData, setFormData] = useState(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
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
        status: "Validando permissões de admin...",
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
            status:
              "Conta registrada. Agora é só marcar isAdmin como true no Firestore para liberar o painel.",
            name: user.displayName || "Conta Google",
            email: user.email || "",
            showDenied: true,
          });
          return;
        }

        setAuthState({
          loggedIn: true,
          isAdmin: true,
          status: "Acesso liberado.",
          name: user.displayName || "Conta Google",
          email: user.email || "",
          showDenied: false,
        });
      } catch (error) {
        console.error(error);
        setAuthState({
          loggedIn: true,
          isAdmin: false,
          status: "Não foi possível validar o acesso agora.",
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
          .sort((a, b) =>
            `${a.category}-${a.title}`.localeCompare(`${b.category}-${b.title}`, "pt-BR")
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

  function handleFieldChange(event) {
    const { name, type, checked, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!authState.isAdmin) {
      window.alert("Faça login com uma conta admin para salvar produtos.");
      return;
    }

    const product = {
      title: formData.title.trim(),
      category: formData.category.trim(),
      price: formData.price.trim(),
      image: formData.image.trim(),
      details: formData.details.trim(),
      available: Boolean(formData.available),
      createdAt: serverTimestamp(),
    };

    if (!product.title || !product.category || !product.price) {
      window.alert("Preencha nome, categoria e preço.");
      return;
    }

    setSubmitting(true);

    try {
      await addDoc(productsCollection, product);
      setFormData(initialFormState);
    } catch (error) {
      console.error(error);
      window.alert(
        "Não foi possível salvar o produto. Confira se sua conta está liberada como admin."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (window.location.protocol === "file:") {
      setAuthState((current) => ({
        ...current,
        status:
          "Abra o admin por localhost ou Firebase Hosting. Login Google não funciona via arquivo local.",
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
      window.alert("Não foi possível sair agora.");
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
      window.alert("Não foi possível atualizar este produto.");
    }
  }

  async function deleteProduct(product) {
    if (!authState.isAdmin) return;

    try {
      const productRef = doc(db, "products", product.id);
      await deleteDoc(productRef);
    } catch (error) {
      console.error(error);
      window.alert("Não foi possível excluir este produto.");
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Painel Admin</h1>
        <p>Cadastre itens do cardápio e controle disponibilidade com login Google.</p>

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
            Faça login com a conta Google autorizada no Firebase. Somente usuários marcados como
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
          <h2>Conta sem permissão de admin</h2>
          <p className="auth-copy">
            Essa conta Google é registrada automaticamente na coleção <code>adminUsers</code>.
            Depois disso, basta mudar o campo <code>isAdmin</code> para <code>true</code> no
            Firestore.
          </p>
        </section>
      ) : null}

      {authState.loggedIn && authState.isAdmin ? (
        <div className="admin-shell">
          <div className="status-banner">{authState.status}</div>

          <section className="admin-card">
            <h2>Novo produto</h2>
            <form className="admin-form" onSubmit={handleSubmit}>
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
                Preço (ex: 25.90)
                <input
                  type="text"
                  name="price"
                  required
                  value={formData.price}
                  onChange={handleFieldChange}
                />
              </label>

              <label>
                Foto (URL)
                <input
                  type="url"
                  name="image"
                  placeholder="https://..."
                  value={formData.image}
                  onChange={handleFieldChange}
                />
              </label>

              <label className="full">
                Descrição
                <textarea
                  name="details"
                  rows="3"
                  value={formData.details}
                  onChange={handleFieldChange}
                />
              </label>

              <label className="toggle">
                <input
                  type="checkbox"
                  name="available"
                  checked={formData.available}
                  onChange={handleFieldChange}
                />
                Disponível no cardápio
              </label>

              <button type="submit" disabled={submitting}>
                {submitting ? "Salvando..." : "Salvar produto"}
              </button>
            </form>
          </section>

          <section className="admin-card">
            <h2>Produtos cadastrados</h2>

            {productsLoading ? <div className="page-message">Carregando produtos...</div> : null}

            {!productsLoading && products.length === 0 ? (
              <div className="empty-state">Nenhum produto cadastrado ainda.</div>
            ) : null}

            <div className="product-list">
              {products.map((product) => (
                <div className="product-row" key={product.id}>
                  <div
                    className="product-thumb"
                    style={
                      product.image
                        ? {
                            backgroundImage: `url("${product.image}")`,
                          }
                        : undefined
                    }
                  />

                  <div>
                    <strong>{product.title}</strong>
                    <br />
                    <small>
                      {product.category} • {formatDisplayPrice(product.price)}
                    </small>
                    <br />
                    <small>{product.available ? "Disponível" : "Indisponível"}</small>
                  </div>

                  <div className="product-actions">
                    <button type="button" onClick={() => toggleProductAvailability(product)}>
                      {product.available ? "Marcar indisponível" : "Marcar disponível"}
                    </button>
                    <button type="button" onClick={() => deleteProduct(product)}>
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
