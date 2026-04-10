"use client";

import Link from "next/link";
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
  subProductsText: "",
  available: true,
};

const MAX_IMAGE_DATA_URL_LENGTH = 450000;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Não foi possível ler a foto selecionada."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Não foi possível ler a foto selecionada."));
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
    throw new Error("Não foi possível preparar a foto para envio.");
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
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageFeedback, setImageFeedback] = useState("");

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
      setImageFeedback("Escolha um arquivo de imagem válido.");
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
      setImageFeedback(error.message || "Não foi possível carregar essa foto.");
    } finally {
      setImageProcessing(false);
    }
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
      subProducts: parseSubProductsText(formData.subProductsText),
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
      setImageFeedback("");
    } catch (error) {
      console.error(error);
      if (error?.code === "permission-denied") {
        const isUploadedImage =
          typeof product.image === "string" && product.image.startsWith("data:image/");

        window.alert(
          isUploadedImage
            ? "Não foi possível salvar a foto deste produto. Publique as rules mais recentes do Firestore e, se precisar, tente uma imagem menor."
            : "Não foi possível salvar o produto porque a gravação foi bloqueada pelas rules do Firestore. Confira se as rules mais recentes foram publicadas."
        );
      } else {
        window.alert("Não foi possível salvar o produto. Tente novamente.");
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

        <div className="admin-shortcuts">
          <Link className="secondary-button" href="/">
            Ver cardápio
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
                Foto
                <input
                  type="text"
                  name="image"
                  placeholder="Cole uma URL ou envie uma foto abaixo"
                  value={formData.image}
                  onChange={handleFieldChange}
                />
              </label>

              <label>
                Enviar foto do celular
                <input type="file" accept="image/*" capture="environment" onChange={handleImageUpload} />
              </label>

              <div className="admin-image-tools full">
                {formData.image ? (
                  <div
                    className="admin-image-preview"
                    style={{
                      backgroundImage: `url("${formData.image}")`,
                    }}
                  />
                ) : (
                  <div className="admin-image-placeholder">A prévia da foto aparece aqui.</div>
                )}

                <div className="admin-image-meta">
                  <p className="admin-image-help">
                    Você pode colar uma URL ou enviar uma foto direto do celular. A imagem é otimizada
                    automaticamente antes de salvar.
                  </p>
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
              </div>

              <label className="full">
                Descrição
                <textarea
                  name="details"
                  rows="3"
                  value={formData.details}
                  onChange={handleFieldChange}
                />
              </label>

              <label className="full">
                Variações do produto
                <textarea
                  name="subProductsText"
                  rows="4"
                  placeholder={"Uma opção por linha"}
                  value={formData.subProductsText}
                  onChange={handleFieldChange}
                />
                <small className="field-help">
                  Se este produto tiver variações (ex: sabores), liste cada opção em uma linha. As opções cadastradas aparecerão como um campo de texto separado no cardápio. Limite de 20 opções.
                </small>
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
