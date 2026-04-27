import { execFile } from 'node:child_process'
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc
} from 'firebase/firestore'
import { initializeApp as initializeAdminApp, cert, getApps as getAdminApps } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const LOCAL_PRINTER_NAME = 'elgin-i7'
const ENV_FILE_CANDIDATES = ['.env.local', '.env']

loadEnvFiles()

const firestoreMode = resolveFirestoreMode()
const processedIds = new Set()
let initialSnapshotLoaded = false

let db = null
let ordersCollection = null
let printRequestsCollection = null
let updatePrintedStatus = null
let updatePrintRequestStatus = null

if (firestoreMode.mode === 'admin') {
  const adminApp = getOrCreateAdminApp(firestoreMode.serviceAccount)
  db = getAdminFirestore(adminApp)
  ordersCollection = db.collection('orders')
  printRequestsCollection = db.collection('printRequests')
  updatePrintedStatus = async orderId => {
    await ordersCollection.doc(orderId).update({
      printCompleted: true,
      printedAt: Timestamp.now()
    })
  }
  updatePrintRequestStatus = async (requestId, status, errorMessage = '') => {
    await printRequestsCollection.doc(requestId).update({
      status,
      printedAt: status === 'printed' ? Timestamp.now() : null,
      errorMessage
    })
  }
} else {
  const firebaseConfig = getFirebaseConfig()
  const app = initializeApp(firebaseConfig)
  db = getFirestore(app)
  updatePrintedStatus = async orderId => {
    const orderRef = doc(db, 'orders', orderId)
    await updateDoc(orderRef, {
      printCompleted: true,
      printedAt: new Date()
    })
  }
  updatePrintRequestStatus = async (requestId, status, errorMessage = '') => {
    const requestRef = doc(db, 'printRequests', requestId)
    await updateDoc(requestRef, {
      status,
      printedAt: status === 'printed' ? new Date() : null,
      errorMessage
    })
  }
}

function loadEnvFiles() {
  for (const fileName of ENV_FILE_CANDIDATES) {
    const filePath = path.join(__dirname, fileName)
    if (!fsSyncExists(filePath)) continue

    const content = requireText(filePath)
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex === -1) return

      const key = trimmed.slice(0, separatorIndex).trim()
      let value = trimmed.slice(separatorIndex + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      if (!(key in process.env)) {
        process.env[key] = value
      }
    })
  }
}

function fsSyncExists(filePath) {
  return existsSync(filePath)
}

function requireText(filePath) {
  return readFileSync(filePath, 'utf8')
}

function getFirebaseConfig() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  }

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(
      `Faltam variaveis do Firebase para a impressora: ${missing.join(', ')}`
    )
  }

  return config
}

function resolveFirestoreMode() {
  const serviceAccountPath = firstFilledEnv(
    'FIREBASE_SERVICE_ACCOUNT_KEY_PATH',
    'GOOGLE_APPLICATION_CREDENTIALS'
  )

  if (serviceAccountPath) {
    const absolutePath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(__dirname, serviceAccountPath)

    if (!fsSyncExists(absolutePath)) {
      throw new Error(`Arquivo de service account nao encontrado: ${absolutePath}`)
    }

    const raw = requireText(absolutePath)
    return {
      mode: 'admin',
      serviceAccount: JSON.parse(raw)
    }
  }

  return { mode: 'client' }
}

function firstFilledEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (value && String(value).trim() !== '') {
      return String(value).trim()
    }
  }

  return ''
}

function getOrCreateAdminApp(serviceAccount) {
  const existing = getAdminApps()
  if (existing.length > 0) {
    return existing[0]
  }

  return initializeAdminApp({
    credential: cert(serviceAccount)
  })
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''")
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const normalized = value
      .trim()
      .replace(/\s+/g, '')
      .replace(/R\$/gi, '')
      .replace(/\./g, '')
      .replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatMoney(value) {
  return toNumber(value).toFixed(2).replace('.', ',')
}

function firstFilled(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }

  return 'Nao informado'
}

function normalizeItems(items = []) {
  const grouped = new Map()

  items.forEach(rawItem => {
    const item = typeof rawItem === 'object' && rawItem ? rawItem : { title: String(rawItem), price: 0, qty: 1 }
    if (item.status && item.status !== 'active') return

    const nome = firstFilled(item.title, item.nome, item.produto)
    const observacao = firstFilled(item.observacao, item.notes, '')
    const preco = toNumber(item.price ?? item.preco)
    const quantidade = Math.max(1, toNumber(item.qty || item.qtd || 1))
    const key = `${nome}__${observacao}__${preco}`

    if (!grouped.has(key)) {
      grouped.set(key, {
        qtd: 0,
        nome,
        preco,
        observacao
      })
    }

    grouped.get(key).qtd += quantidade
  })

  return Array.from(grouped.values())
}

function encodeText(text) {
  return iconv.encode(String(text), 'cp860')
}

function line(text = '') {
  return Buffer.concat([encodeText(text), Buffer.from([0x0a])])
}

function align(mode = 'left') {
  const modes = { left: 0, center: 1, right: 2 }
  return Buffer.from([0x1b, 0x61, modes[mode] ?? 0])
}

function bold(enabled) {
  return Buffer.from([0x1b, 0x45, enabled ? 1 : 0])
}

function textSize(width = 1, height = 1) {
  const w = Math.max(1, Math.min(8, width)) - 1
  const h = Math.max(1, Math.min(8, height)) - 1
  return Buffer.from([0x1d, 0x21, (w << 4) | h])
}

function hr(char = '-') {
  return line(char.repeat(32))
}

function feed(lines = 1) {
  return Buffer.from(new Array(lines).fill(0x0a))
}

function cut() {
  return Buffer.from([0x1d, 0x56, 0x00])
}

function getCustomerData(order = {}) {
  const customer = order.customer || {}
  const address = [
    firstFilled(customer.address),
    firstFilled(customer.addressNumber, ''),
    firstFilled(customer.district, ''),
    firstFilled(customer.complement, ''),
    customer.cep ? `CEP: ${customer.cep}` : ''
  ]
    .filter(Boolean)
    .join(' - ')

  return {
    name: firstFilled(customer.name, order.customerName, 'Balcao'),
    phone: firstFilled(customer.phone, ''),
    payment: firstFilled(customer.payment, order.payment),
    address: address || 'Nao informado',
    notes: firstFilled(customer.notes, order.notes, '')
  }
}

function formatDate(order = {}) {
  const raw = order.createdAt
  if (raw && typeof raw.toDate === 'function') {
    return raw.toDate().toLocaleString('pt-BR')
  }
  if (raw instanceof Date) {
    return raw.toLocaleString('pt-BR')
  }
  return new Date().toLocaleString('pt-BR')
}

function buildReceiptBuffer(order, options = {}) {
  const customer = getCustomerData(order)
  const items = normalizeItems(order.items || [])
  const subtotal = toNumber(order.subtotal) || items.reduce((sum, item) => sum + item.preco * item.qtd, 0)
  const discount = toNumber(order.discount)
  const surcharge = toNumber(order.surcharge)
  const total = toNumber(order.total) || subtotal
  const receiptTitle = firstFilled(options.title, order.receiptTitle, 'NOVO PEDIDO')
  const source = firstFilled(options.source, order.source, '')
  const showAddress = source !== 'cashSale' && customer.address !== 'Nao informado'

  const buffers = []
  buffers.push(Buffer.from([0x1b, 0x40]))
  buffers.push(align('center'))
  buffers.push(bold(true))
  buffers.push(textSize(2, 2))
  buffers.push(line('BOLO DE MAE JP'))
  buffers.push(textSize(1, 1))
  buffers.push(line(receiptTitle))
  buffers.push(bold(false))
  buffers.push(hr('='))

  buffers.push(align('left'))
  buffers.push(bold(true))
  buffers.push(line(`PEDIDO: #${firstFilled(order.orderCode, order.id, '')}`))
  buffers.push(line(`DATA: ${formatDate(order)}`))
  buffers.push(line(`CLIENTE: ${customer.name}`))
  if (customer.phone && customer.phone !== 'Nao informado') {
    buffers.push(line(`CONTATO: ${customer.phone}`))
  }
  buffers.push(line(`PAGAMENTO: ${customer.payment}`))
  if (showAddress) {
    buffers.push(line(`ENDERECO: ${customer.address}`))
  }
  buffers.push(bold(false))

  if (customer.notes && customer.notes !== 'Nao informado') {
    buffers.push(hr())
    buffers.push(bold(true))
    buffers.push(line('OBSERVACOES DO CLIENTE'))
    buffers.push(bold(false))
    buffers.push(line(customer.notes))
  }

  buffers.push(hr())
  buffers.push(bold(true))
  buffers.push(line('ITENS'))
  buffers.push(bold(false))
  buffers.push(hr())

  items.forEach(item => {
    buffers.push(line(`${item.qtd}x ${item.nome}`))
    if (item.observacao) {
      buffers.push(line(`  Obs: ${item.observacao}`))
    }
    buffers.push(line(`  Unit: R$ ${formatMoney(item.preco)}  Total: R$ ${formatMoney(item.preco * item.qtd)}`))
  })

  buffers.push(hr())
  buffers.push(bold(true))
  buffers.push(line(`SUBTOTAL: R$ ${formatMoney(subtotal)}`))
  if (discount > 0) {
    buffers.push(line(`DESCONTO: R$ ${formatMoney(discount)}`))
  }
  if (surcharge > 0) {
    buffers.push(line(`ACRESCIMO: R$ ${formatMoney(surcharge)}`))
  }
  buffers.push(textSize(2, 2))
  buffers.push(line(`TOTAL: R$ ${formatMoney(total)}`))
  buffers.push(textSize(1, 1))
  buffers.push(bold(false))
  buffers.push(hr('='))
  buffers.push(align('center'))
  buffers.push(line('OBRIGADO!'))
  buffers.push(feed(5))
  buffers.push(cut())

  return Buffer.concat(buffers)
}

function sendRawToPrinter(buffer, printerName) {
  return new Promise(async (resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `only-order-${Date.now()}.bin`)

    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
}
"@

$printerName = '${escapePowerShell(printerName)}'
$filePath = '${escapePowerShell(tempFile)}'
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$docInfo = New-Object RawPrinterHelper+DOCINFO
$docInfo.pDocName = 'Only Pedido'
$docInfo.pDataType = 'RAW'

$printerHandle = [IntPtr]::Zero
if (-not [RawPrinterHelper]::OpenPrinter($printerName, [ref]$printerHandle, [IntPtr]::Zero)) {
  throw "Nao foi possivel abrir a impressora $printerName. Codigo: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

try {
  if (-not [RawPrinterHelper]::StartDocPrinter($printerHandle, 1, $docInfo)) {
    throw "Nao foi possivel iniciar o documento de impressao. Codigo: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  try {
    if (-not [RawPrinterHelper]::StartPagePrinter($printerHandle)) {
      throw "Nao foi possivel iniciar a pagina de impressao. Codigo: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    try {
      $written = 0
      if (-not [RawPrinterHelper]::WritePrinter($printerHandle, $bytes, $bytes.Length, [ref]$written)) {
        throw "Nao foi possivel enviar os dados RAW para a impressora. Codigo: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
      }
    }
    finally {
      [RawPrinterHelper]::EndPagePrinter($printerHandle) | Out-Null
    }
  }
  finally {
    [RawPrinterHelper]::EndDocPrinter($printerHandle) | Out-Null
  }
}
finally {
  [RawPrinterHelper]::ClosePrinter($printerHandle) | Out-Null
}
`

    try {
      await fs.writeFile(tempFile, buffer)
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        async (err, stdout, stderr) => {
          try {
            await fs.unlink(tempFile)
          } catch {}

          if (err) {
            reject(new Error(`Erro ao enviar ESC/POS para ${printerName}: ${stderr || err.message}`))
            return
          }

          resolve(stdout)
        }
      )
    } catch (error) {
      reject(error)
    }
  })
}

async function printOrder(order) {
  const buffer = buildReceiptBuffer(order)
  await sendRawToPrinter(buffer, LOCAL_PRINTER_NAME)
}

async function printRequest(request) {
  const payload = {
    ...(request.payload || {}),
    id: request.sourceId || request.id,
    source: request.source
  }
  const title = request.source === 'cashSale' ? 'COMPROVANTE' : 'REIMPRESSAO'
  const buffer = buildReceiptBuffer(payload, {
    title,
    source: request.source
  })

  await sendRawToPrinter(buffer, LOCAL_PRINTER_NAME)
}

async function markPrinted(orderId) {
  await updatePrintedStatus(orderId)
}

function shouldPrint(order) {
  return order.printCompleted !== true
}

function shouldPrintRequest(request) {
  return request.status === 'pending'
}

async function handlePrintRequest(requestId, request) {
  try {
    console.log(`Imprimindo solicitacao ${request.sourceCode || requestId}...`)
    await printRequest({ id: requestId, ...request })
    await updatePrintRequestStatus(requestId, 'printed')
    console.log(`Solicitacao ${request.sourceCode || requestId} marcada como impressa.`)
  } catch (error) {
    console.error(`Falha ao imprimir solicitacao ${request.sourceCode || requestId}:`, error)

    try {
      await updatePrintRequestStatus(
        requestId,
        'failed',
        error?.message ? String(error.message).slice(0, 500) : 'Falha desconhecida'
      )
    } catch (updateError) {
      console.error(`Falha ao marcar solicitacao ${request.sourceCode || requestId} como erro:`, updateError)
    }
  }
}

function startListening() {
  if (firestoreMode.mode === 'admin') {
    ordersCollection.orderBy('createdAt', 'asc').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        const orderId = change.doc.id
        const order = { id: orderId, ...change.doc.data() }
        const signature = `${orderId}-${order.updatedAt?._seconds || order.createdAt?._seconds || order.createdAt?.seconds || 'base'}`

        if (!initialSnapshotLoaded && change.type === 'added') {
          processedIds.add(signature)
          return
        }

        if ((change.type === 'added' || change.type === 'modified') && shouldPrint(order)) {
          if (processedIds.has(signature)) return
          processedIds.add(signature)

          try {
            console.log(`Imprimindo pedido ${order.orderCode || orderId}...`)
            await printOrder(order)
            await markPrinted(orderId)
            console.log(`Pedido ${order.orderCode || orderId} marcado como impresso.`)
          } catch (error) {
            console.error(`Falha ao imprimir o pedido ${order.orderCode || orderId}:`, error)
          }
        }
      })
      initialSnapshotLoaded = true
    }, error => {
      console.error('Erro ao escutar pedidos do Firestore:', error)
    })

    printRequestsCollection.orderBy('requestedAt', 'asc').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const requestId = change.doc.id
        const request = { id: requestId, ...change.doc.data() }
        const signature = `printRequest-${requestId}-${request.status || 'pending'}`

        if ((change.type === 'added' || change.type === 'modified') && shouldPrintRequest(request)) {
          if (processedIds.has(signature)) return
          processedIds.add(signature)
          handlePrintRequest(requestId, request)
        }
      })
    }, error => {
      console.error('Erro ao escutar solicitacoes de impressao:', error)
    })

    return
  }

  const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'asc'))
  const printRequestsQuery = query(collection(db, 'printRequests'), orderBy('requestedAt', 'asc'))

  onSnapshot(ordersQuery, snapshot => {
    snapshot.docChanges().forEach(async change => {
      const orderId = change.doc.id
      const order = { id: orderId, ...change.doc.data() }
      const signature = `${orderId}-${order.updatedAt?.seconds || order.createdAt?.seconds || 'base'}`

      if (!initialSnapshotLoaded && change.type === 'added') {
        processedIds.add(signature)
        return
      }

      if ((change.type === 'added' || change.type === 'modified') && shouldPrint(order)) {
        if (processedIds.has(signature)) return
        processedIds.add(signature)

        try {
          console.log(`Imprimindo pedido ${order.orderCode || orderId}...`)
          await printOrder(order)
          await markPrinted(orderId)
          console.log(`Pedido ${order.orderCode || orderId} marcado como impresso.`)
        } catch (error) {
          console.error(`Falha ao imprimir o pedido ${order.orderCode || orderId}:`, error)
        }
      }
    })
    initialSnapshotLoaded = true
  }, error => {
    console.error('Erro ao escutar pedidos do Firestore:', error)
  })

  onSnapshot(printRequestsQuery, snapshot => {
    snapshot.docChanges().forEach(change => {
      const requestId = change.doc.id
      const request = { id: requestId, ...change.doc.data() }
      const signature = `printRequest-${requestId}-${request.status || 'pending'}`

      if ((change.type === 'added' || change.type === 'modified') && shouldPrintRequest(request)) {
        if (processedIds.has(signature)) return
        processedIds.add(signature)
        handlePrintRequest(requestId, request)
      }
    })
  }, error => {
    console.error('Erro ao escutar solicitacoes de impressao:', error)
  })
}

startListening()
console.log(`Sistema de impressao do Only iniciado na impressora ${LOCAL_PRINTER_NAME} (${firestoreMode.mode}).`)
