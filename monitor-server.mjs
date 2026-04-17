import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROCESS_NAME = 'only-impressora'
const PORT = 3211
const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dashboardPath = path.join(__dirname, 'monitor.html')
const pm2Executable = path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd')

function json(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function runPm2(args) {
  const { stdout, stderr } = await execFileAsync('cmd.exe', ['/c', pm2Executable, ...args], {
    windowsHide: true,
    cwd: __dirname,
    maxBuffer: 1024 * 1024
  })
  return { stdout, stderr }
}

async function getProcessStatus() {
  try {
    const { stdout } = await runPm2(['jlist'])
    const list = JSON.parse(stdout)
    const proc = list.find(item => item.name === PROCESS_NAME)

    if (!proc) {
      return {
        installed: true,
        exists: false,
        online: false,
        status: 'not_found',
        uptime: 0,
        restarts: 0,
        pid: null,
        monit: { memory: 0, cpu: 0 }
      }
    }

    return {
      installed: true,
      exists: true,
      online: proc.pm2_env?.status === 'online',
      status: proc.pm2_env?.status || 'unknown',
      uptime: proc.pm2_env?.pm_uptime || 0,
      restarts: proc.pm2_env?.restart_time || 0,
      pid: proc.pid || null,
      monit: proc.monit || { memory: 0, cpu: 0 }
    }
  } catch (error) {
    return {
      installed: false,
      exists: false,
      online: false,
      status: 'pm2_unavailable',
      error: error.message,
      uptime: 0,
      restarts: 0,
      pid: null,
      monit: { memory: 0, cpu: 0 }
    }
  }
}

async function startPrinterProcess() {
  return runPm2(['start', 'teste.mjs', '--name', PROCESS_NAME])
}

async function restartPrinterProcess() {
  return runPm2(['restart', PROCESS_NAME])
}

async function stopPrinterProcess() {
  return runPm2(['stop', PROCESS_NAME])
}

async function fetchLogs(lines = 30) {
  try {
    const { stdout } = await runPm2(['logs', PROCESS_NAME, '--lines', String(lines), '--nostream'])
    return stdout.trim()
  } catch (error) {
    return `Nao foi possivel ler os logs: ${error.message}`
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/') {
      const html = await readFile(dashboardPath, 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, await getProcessStatus())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      json(res, 200, { logs: await fetchLogs(40) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/start') {
      await startPrinterProcess()
      json(res, 200, await getProcessStatus())
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/restart') {
      await restartPrinterProcess()
      json(res, 200, await getProcessStatus())
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/stop') {
      await stopPrinterProcess()
      json(res, 200, await getProcessStatus())
      return
    }

    json(res, 404, { error: 'Rota nao encontrada' })
  } catch (error) {
    json(res, 500, { error: error.message })
  }
})

server.listen(PORT, () => {
  console.log(`Painel da impressora Only disponivel em http://localhost:${PORT}`)
})
