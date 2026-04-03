import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { auth, db, googleProvider } from "./firebase-client.js";

const productsCollection = collection(db, "products");

const form = document.getElementById("product-form");
const list = document.getElementById("product-list");
const authCard = document.getElementById("auth-card");
const accessDenied = document.getElementById("access-denied");
const authStatus = document.getElementById("auth-status");
const googleSignInButton = document.getElementById("google-sign-in");
const signOutButton = document.getElementById("sign-out-button");
const adminShell = document.getElementById("admin-shell");
const adminSession = document.getElementById("admin-session");
const sessionName = document.getElementById("session-name");
const sessionEmail = document.getElementById("session-email");

let unsubscribeProducts = null;
let adminEnabled = false;

const describeAuthError = (error) => {
  const code = error?.code || "auth/unknown";

  if (code === "auth/unauthorized-domain") {
    return "Domínio não autorizado no Firebase. Adicione este domínio em Authentication > Settings > Authorized domains.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Login com Google não está habilitado corretamente no Firebase Authentication.";
  }

  if (code === "auth/popup-blocked") {
    return "O navegador bloqueou o popup de login. Libere popups para este site.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "A janela de login foi fechada antes da autenticação terminar.";
  }

  if (code === "auth/cancelled-popup-request") {
    return "Houve mais de uma tentativa de abrir o popup ao mesmo tempo.";
  }

  return `Não foi possível entrar com Google. Código: ${code}`;
};

const formatDisplayPrice = (value) => {
  if (typeof value === "string" && value.includes("R$")) return value;
  const numberValue = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(numberValue)) return "R$ 0,00";
  return `R$ ${numberValue.toFixed(2).replace(".", ",")}`;
};

const setAuthState = ({
  loggedIn,
  isAdmin,
  status,
  name = "",
  email = "",
  showDenied = false,
}) => {
  authCard.hidden = loggedIn && isAdmin;
  adminShell.hidden = !loggedIn || !isAdmin;
  adminSession.hidden = !loggedIn;
  accessDenied.hidden = !showDenied;
  authStatus.textContent = status;
  sessionName.textContent = name;
  sessionEmail.textContent = email;
  adminEnabled = loggedIn && isAdmin;
};

const getAdminDocId = (user) => {
  const email = user?.email?.trim();
  return email || "";
};

const isAllowedAdmin = async (user) => {
  const adminDocId = getAdminDocId(user);
  if (!adminDocId) return false;

  const adminRef = doc(db, "adminUsers", adminDocId);
  const adminSnap = await getDoc(adminRef);
  const data = adminSnap.data() || {};

  return adminSnap.exists() && (data.isAdmin === true || data.active === true);
};

const ensureAdminProfile = async (user) => {
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
};

const stopProductsListener = () => {
  if (typeof unsubscribeProducts === "function") {
    unsubscribeProducts();
    unsubscribeProducts = null;
  }
};

const renderList = (products) => {
  list.innerHTML = "";

  products.forEach((product) => {
    const row = document.createElement("div");
    row.className = "product-row";
    row.innerHTML = `
      <div class="product-thumb" style="background-image: ${product.image ? `url('${product.image}')` : "none"}"></div>
      <div>
        <strong>${product.title}</strong><br />
        <small>${product.category} • ${formatDisplayPrice(product.price)}</small><br />
        <small>${product.available ? "Disponível" : "Indisponível"}</small>
      </div>
      <div class="product-actions">
        <button type="button" data-action="toggle">${product.available ? "Marcar indisponível" : "Marcar disponível"}</button>
        <button type="button" data-action="delete">Excluir</button>
      </div>
    `;

    row.querySelector("[data-action='toggle']").addEventListener("click", async () => {
      if (!adminEnabled) return;

      try {
        const ref = doc(db, "products", product.id);
        await updateDoc(ref, { available: !product.available });
      } catch (error) {
        console.error(error);
        alert("Não foi possível atualizar este produto.");
      }
    });

    row.querySelector("[data-action='delete']").addEventListener("click", async () => {
      if (!adminEnabled) return;

      try {
        const ref = doc(db, "products", product.id);
        await deleteDoc(ref);
      } catch (error) {
        console.error(error);
        alert("Não foi possível excluir este produto.");
      }
    });

    list.appendChild(row);
  });
};

const startProductsListener = () => {
  stopProductsListener();
  unsubscribeProducts = onSnapshot(productsCollection, (snapshot) => {
    const products = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    renderList(products);
  });
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!adminEnabled) {
    alert("Faça login com uma conta admin para salvar produtos.");
    return;
  }

  const data = new FormData(form);
  const product = {
    title: data.get("title").toString().trim(),
    category: data.get("category").toString().trim(),
    price: data.get("price").toString().trim(),
    image: data.get("image").toString().trim(),
    details: data.get("details").toString().trim(),
    available: data.get("available") === "on",
    createdAt: serverTimestamp(),
  };

  if (!product.title || !product.category || !product.price) {
    alert("Preencha nome, categoria e preço.");
    return;
  }

  try {
    await addDoc(productsCollection, product);
    form.reset();
  } catch (error) {
    console.error(error);
    alert("Não foi possível salvar o produto. Confira se sua conta está liberada como admin.");
  }
});

googleSignInButton.addEventListener("click", async () => {
  if (window.location.protocol === "file:") {
    authStatus.textContent = "Abra o admin por localhost ou Firebase Hosting. Login Google não funciona via arquivo local.";
    return;
  }

  googleSignInButton.disabled = true;
  authStatus.textContent = "Abrindo login do Google...";

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error(error);
    authStatus.textContent = describeAuthError(error);
    googleSignInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
    alert("Não foi possível sair agora.");
  }
});

onAuthStateChanged(auth, async (user) => {
  googleSignInButton.disabled = false;
  stopProductsListener();
  list.innerHTML = "";

  if (!user) {
    setAuthState({
      loggedIn: false,
      isAdmin: false,
      status: "Entre com Google para continuar.",
    });
    return;
  }

  setAuthState({
    loggedIn: true,
    isAdmin: false,
    status: "Validando permissões de admin...",
    name: user.displayName || "Conta Google",
    email: user.email || "",
  });

  try {
    await ensureAdminProfile(user);
    const allowed = await isAllowedAdmin(user);

    if (!allowed) {
      setAuthState({
        loggedIn: true,
        isAdmin: false,
        status: "Conta registrada. Agora é só marcar isAdmin como true no Firestore para liberar o painel.",
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
    });
    startProductsListener();
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
