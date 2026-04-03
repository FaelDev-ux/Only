import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCus77pZp_rUNAJNaPThrcGavdXkkJSdF0",
  authDomain: "bolodemaejp.firebaseapp.com",
  projectId: "bolodemaejp",
  storageBucket: "bolodemaejp.firebasestorage.app",
  messagingSenderId: "18591522219",
  appId: "1:18591522219:web:a34f04b6dc8474ee4106ee",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const productsCollection = collection(db, "products");

const form = document.getElementById("product-form");
const list = document.getElementById("product-list");

const requireAdminPassword = () => {
  const configured = typeof window.ADMIN_PASSWORD === "string" && window.ADMIN_PASSWORD.length > 0;
  if (!configured || window.ADMIN_PASSWORD === "TROQUE_ESTA_SENHA") {
    alert("Defina uma senha em admin-config.js antes de usar o admin.");
    return false;
  }

  if (localStorage.getItem("admin_authed") === "true") {
    return true;
  }

  const input = window.prompt("Senha do admin:");
  if (input === window.ADMIN_PASSWORD) {
    localStorage.setItem("admin_authed", "true");
    return true;
  }

  alert("Senha incorreta.");
  return false;
};

if (!requireAdminPassword()) {
  throw new Error("Admin access denied");
}

const formatDisplayPrice = (value) => {
  if (typeof value === "string" && value.includes("R$")) return value;
  const numberValue = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(numberValue)) return "R$ 0,00";
  return `R$ ${numberValue.toFixed(2).replace(".", ",")}`;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
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

  await addDoc(productsCollection, product);
  form.reset();
});

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
      const ref = doc(db, "products", product.id);
      await updateDoc(ref, { available: !product.available });
    });

    row.querySelector("[data-action='delete']").addEventListener("click", async () => {
      const ref = doc(db, "products", product.id);
      await deleteDoc(ref);
    });

    list.appendChild(row);
  });
};

onSnapshot(productsCollection, (snapshot) => {
  const products = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  renderList(products);
});
