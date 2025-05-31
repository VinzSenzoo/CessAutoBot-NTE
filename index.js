import axios from 'axios';
import cfonts from 'cfonts';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import readline from 'readline';
import FormData from 'form-data';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ethers } from 'ethers';

const RPC_URL = "https://eth.merkle.io/"; 
const PLATFORM = "okex";

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function centerText(text, color = 'greenBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

function printSeparator() {
  console.log(chalk.bold.cyanBright('================================================================================'));
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, seperti Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, seperti Gecko) Version/15.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, seperti Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, seperti Gecko) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getHeaders(token = null, isMultipart = false) {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    'Origin': 'https://cess.network',
    'Referer': 'https://cess.network/'
  };
  if (token) {
    headers['token'] = token;
  }
  return headers;
}

function getAxiosConfig(proxy, token = null, isMultipart = false) {
  const config = {
    headers: getHeaders(token, isMultipart),
    timeout: 60000,
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    console.log(chalk.red(`Unsupported proxy type: ${proxy}`));
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 3, backoff = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else {
        throw new Error(`Metode ${method} tidak didukung.`);
      }
      return response;
    } catch (error) {
      if (i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      } else {
        throw error;
      }
    }
  }
}

function makeNonce(platform, timestampMs) {
  return Buffer.from(`${platform}-${timestampMs}`).toString("hex");
}

function makeIssuedAt(timestampMs) {
  return new Date(timestampMs).toISOString();
}

async function getTokenFromPrivateKey(privateKey, proxy = null) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = await wallet.getAddress();

  const uri = "https://cess.network/deshareairdrop";
  const version = "1";
  const timestampMs = Date.now();
  const nonce = makeNonce(PLATFORM, timestampMs);
  const issuedAt = makeIssuedAt(timestampMs);

  const message = `cess.network wants you to sign in with your account address:
${address}

Sign in to the app. Powered by cess.network Solutions.

URI: ${uri}
Version: ${version}
Nonce: ${nonce}
Issued At: ${issuedAt}`;

  const signature = await wallet.signMessage(message);

  const payload = {
    account: address,
    platform: PLATFORM,
    message,
    sign: signature
  };

  const config = getAxiosConfig(proxy, null, false);

  try {
    const res = await axios.post(
      "https://merklev2.cess.network/merkle/wlogin",
      payload,
      config
    );
    if (res.data.code === 200) {
      return res.data.data;
    } else {
      throw new Error(`Login gagal: ${res.data.msg}`);
    }
  } catch (err) {
    throw new Error(`Error login: ${err.message}`);
  }
}

async function readPrivateKeys() {
  try {
    const data = await fs.readFile('pk.txt', 'utf-8');
    return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error membaca pk.txt: ${error.message}`));
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    return data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error membaca proxy.txt: ${error.message}`));
    return [];
  }
}

async function getPublicIP(proxy) {
  try {
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, getAxiosConfig(proxy));
    return response?.data?.ip || 'IP tidak ditemukan';
  } catch (error) {
    return 'Error mengambil IP';
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

let globalUseProxy = false;
let globalProxies = [];

async function initializeConfig() {
  const useProxyAns = await askQuestion('Ingin menggunakan proxy? (y/n): ');
  if (useProxyAns.trim().toLowerCase() === 'y') {
    globalUseProxy = true;
    globalProxies = await readProxies();
    if (globalProxies.length === 0) {
      console.log(chalk.yellow('Tidak ada proxy di proxy.txt. Lanjut tanpa proxy.'));
      globalUseProxy = false;
    }
  }
}

async function processToken(token, index, total, proxy = null) {
  console.log();
  printSeparator();
  console.log(chalk.bold.whiteBright(`Akun: ${index + 1}/${total}`));

  let statusRes;
  const spinnerStatus = ora({ text: 'Mengambil status akun...', spinner: 'dots2', color: 'cyan' }).start();
  try {
    const response = await requestWithRetry('get', 'https://merklev2.cess.network/merkle/task/status', null, getAxiosConfig(proxy, token));
    statusRes = response.data.data;
    spinnerStatus.succeed(chalk.greenBright(' Status akun berhasil didapatkan'));
  } catch (error) {
    spinnerStatus.fail(chalk.red(` Gagal mengambil status: ${error.message}`));
    return;
  }

  const accountData = statusRes.account;
  const username = accountData.username;
  const uuid = accountData.uuid;
  const wallet = accountData.account;
  console.log(chalk.whiteBright(`Username   : ${username}`));
  console.log(chalk.whiteBright(`UUID       : ${uuid}`));
  console.log(chalk.whiteBright(`Wallet     : ${wallet}`));
  const ip = await getPublicIP(proxy);
  console.log(chalk.whiteBright(`IP yang digunakan: ${ip}`));
  printSeparator();
  console.log();

  const spinnerCheckin = ora({ text: ' Melakukan checkin...', spinner: 'dots2', color: 'cyan' }).start();
  try {
    const response = await requestWithRetry('post', 'https://merklev2.cess.network/merkle/task/checkin', {}, getAxiosConfig(proxy, token));
    if (response.data && response.data.code === 200) {
      spinnerCheckin.succeed(chalk.greenBright(` Checkin berhasil, reward: ${response.data.data}`));
    } else {
      spinnerCheckin.fail(chalk.red(' Checkin gagal: ' + (response.data.data || 'Response tidak valid')));
    }
  } catch (error) {
    spinnerCheckin.fail(chalk.red(` Checkin gagal: ${error.message}`));
  }

  for (let i = 0; i < 3; i++) {
    const spinnerUpload = ora({ text: ` Upload gambar ${i + 1}/3...`, spinner: 'dots2', color: 'cyan' }).start();
    try {
      const randomSeed = Math.floor(Math.random() * 100000);
      const imageUrl = `https://picsum.photos/seed/${randomSeed}/500/500`;
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = imageResponse.data;
      const generatedFilename = `image_${Date.now()}_${randomSeed}.png`;
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: generatedFilename,
        contentType: 'image/png'
      });
      form.append('user_uuid', uuid);
      form.append('output', 'json2');
      form.append('filename', generatedFilename);
      form.append('user_wallet', wallet);

      const uploadHeaders = {
        ...form.getHeaders(),
        'User-Agent': getRandomUserAgent(),
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://cess.network',
        'Referer': 'https://cess.network/'
      };

      const uploadConfig = {
        headers: uploadHeaders,
        timeout: 60000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      };
      if (proxy) {
        uploadConfig.httpsAgent = newAgent(proxy);
        uploadConfig.proxy = false;
      }

      const uploadResponse = await axios.post('https://filepool.cess.network/group1/upload', form, uploadConfig);
      if (uploadResponse.data && uploadResponse.data.status === 'ok') {
        spinnerUpload.succeed(chalk.greenBright(` Upload gambar ${i + 1}/3 berhasil`));
      } else {
        spinnerUpload.fail(chalk.red(` Upload gambar ${i + 1}/3 gagal: ${uploadResponse.data.message || 'Response tidak valid'}`));
      }
    } catch (error) {
      spinnerUpload.fail(chalk.red(` Upload gambar ${i + 1}/3 gagal: ${error.message}`));
    }
    await delay(1);
  }

  const spinnerPoint = ora({ text: ' Mengambil total points...', spinner: 'dots2', color: 'cyan' }).start();
  try {
    const finalResponse = await requestWithRetry('get', 'https://merklev2.cess.network/merkle/task/status', null, getAxiosConfig(proxy, token));
    const finalPoints = finalResponse.data.data.account.points;
    spinnerPoint.succeed(chalk.greenBright(` Total Points : ${finalPoints}`));
  } catch (error) {
    spinnerPoint.fail(chalk.red(` Gagal mengambil points: ${error.message}`));
  }
  printSeparator();
}

async function runCycle() {
  const privateKeys = await readPrivateKeys();
  if (privateKeys.length === 0) {
    console.log(chalk.red('Tidak ada private key di pk.txt.'));
    return;
  }

  for (let i = 0; i < privateKeys.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      const token = await getTokenFromPrivateKey(privateKeys[i], proxy);
      await processToken(token, i, privateKeys.length, proxy);
    } catch (error) {
      console.error(chalk.red(`Error pada akun ${i + 1}: ${error.message}`));
    }
  }
}

async function run() {
  cfonts.say('NT EXHAUST', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true
  });
  console.log(centerText("=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ==="));
  console.log(centerText("✪ CESS AUTO DAILY CHECKIN & UPLOAD FILES ✪ \n"));
  await initializeConfig();

  while (true) {
    await runCycle();
    console.log(chalk.magentaBright('Siklus selesai. Menunggu 24 jam sebelum pengulangan...'));
    await delay(86400);
  }
}

run();
