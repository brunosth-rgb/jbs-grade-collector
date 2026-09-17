import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const BASE_URL = 'https://portal.jbsterminais.com.br';
const GRADE_URL = `${BASE_URL}/grade-agendamento`;

const USER = process.env.PORTAL_USER;
const PASSWORD = process.env.PORTAL_PASSWORD;

const HEADLESS =
  String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

const AUTH_DIR = path.resolve('.auth');
const OUTPUT_DIR = path.resolve('output');

const AUTH_FILE = path.join(AUTH_DIR, 'portal.json');

fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

if (!USER || !PASSWORD) {
  throw new Error(
    'PORTAL_USER e PORTAL_PASSWORD precisam estar definidos no arquivo .env'
  );
}

function agoraISO() {
  return new Date().toISOString();
}

function nomeArquivoTimestamp() {
  return new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');
}

async function fazerLogin(page) {
  console.log('Realizando login no Portal JBS...');

  await page.goto(`${BASE_URL}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('Página de login aberta.');
  console.log('URL:', page.url());

  await page.waitForTimeout(3000);

  async function encontrarUsuario(page) {
  console.log('Aguardando formulário de login...');

  try {
    await page.locator('input').first().waitFor({
      state: 'attached',
      timeout: 60000
    });
  } catch {
    console.log('Nenhum input apareceu após 60 segundos.');

    console.log('URL atual:', page.url());
    console.log('Título:', await page.title());

    await page.screenshot({
      path: 'output/login-debug.png',
      fullPage: true
    });

    throw new Error(
      'Formulário de login não carregou. Screenshot salvo em output/login-debug.png'
    );
  }

  await page.waitForTimeout(1500);

  const inputs = await page.locator('input').evaluateAll(elementos =>
    elementos.map((el, i) => ({
      i,
      type: el.type,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      autocomplete: el.autocomplete,
      visible: !!(
        el.offsetWidth ||
        el.offsetHeight ||
        el.getClientRects().length
      )
    }))
  );

  console.log('Inputs encontrados:');
  console.table(inputs);

  const seletores = [
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[name*="user" i]',
    'input[name*="usuario" i]',
    'input[id*="email" i]',
    'input[id*="login" i]',
    'input[id*="user" i]',
    'input[id*="usuario" i]',
    'input[type="text"]'
  ];

  for (const seletor of seletores) {
    const candidatos = page.locator(seletor);

    const quantidade = await candidatos.count();

    for (let i = 0; i < quantidade; i++) {
      const candidato = candidatos.nth(i);

      if (await candidato.isVisible()) {
        console.log(
          `Campo de usuário identificado com: ${seletor}`
        );

        return candidato;
      }
    }
  }

  await page.screenshot({
    path: 'output/login-debug.png',
    fullPage: true
  });

  throw new Error(
    'Campo de usuário não identificado. Verifique os inputs exibidos acima. Screenshot salvo em output/login-debug.png'
  );
}

  throw new Error('Campo de usuário não encontrado.');
}

async function fazerLogin(page) {
  console.log('Realizando login no Portal JBS...');

  await page.goto(`${BASE_URL}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  const usuario = await encontrarUsuario(page);

  const senha = page
    .locator('input[type="password"]')
    .first();

  await usuario.fill(USER);
  await senha.fill(PASSWORD);

  const possibilidades = [
    page.getByRole('button', { name: /entrar/i }),
    page.getByRole('button', { name: /login/i }),
    page.getByRole('button', { name: /acessar/i }),
    page.locator('button[type="submit"]'),
    page.locator('input[type="submit"]')
  ];

  let clicou = false;

  for (const botao of possibilidades) {
    if (await botao.count()) {
      await botao.first().click();
      clicou = true;
      break;
    }
  }

  if (!clicou) {
    throw new Error('Botão de login não encontrado.');
  }

  await page.waitForURL(
    url => !url.toString().toLowerCase().includes('/login'),
    {
      timeout: 60000
    }
  );

  console.log('Login realizado.');
}

async function esperarGrade(page) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('input[name="_value"]')]
        .some(el => el.offsetParent !== null),
    null,
    {
      timeout: 60000
    }
  );
}

async function abrirGrade(page) {
  console.log('Abrindo Grade de Agendamento...');

  await page.goto(GRADE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  if (await precisaLogin(page)) {
    await fazerLogin(page);

    await page.goto(GRADE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
  }

  await esperarGrade(page);

  console.log('Grade carregada.');
}

async function extrairGrade(page) {
  return await page.evaluate(() => {

    function limparCategoria(texto) {
      return texto
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[\+?-?\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const dias = {
      segunda: 'Seg',
      terca: 'Ter',
      terça: 'Ter',
      quarta: 'Qua',
      quinta: 'Qui',
      sexta: 'Sex',
      sabado: 'Sáb',
      sábado: 'Sáb',
      domingo: 'Dom'
    };

    const paineis = [
      ...document.querySelectorAll('.rz-tabview-panel')
    ];

    const painel =
      paineis.find(el => el.offsetParent !== null)
      || document.body;

    const inputs = [
      ...painel.querySelectorAll('input[name="_value"]')
    ].filter(el => el.offsetParent !== null);

    const registros = [];

    for (const input of inputs) {

      const textoCategoria =
        input.parentElement?.innerText
          ?.trim()
          .replace(/\s+/g, ' ')
        || '';

      const categoria =
        limparCategoria(textoCategoria);

      let node = input;

      let dia = '';
      let dayNode = null;

      while (node && node !== painel) {

        const classeDia =
          [...node.classList]
            .map(c => c.toLowerCase())
            .find(c => dias[c]);

        if (classeDia) {
          dia = dias[classeDia];
          dayNode = node;
          break;
        }

        node = node.parentElement;
      }

      let inicio = '';
      let fim = '';
      let periodoNode = null;

      node = input;

      while (node && node !== painel) {

        const texto =
          node.innerText
            ?.trim()
            .replace(/\s+/g, ' ');

        const match =
          texto?.match(
            /(\d{2}:\d{2})\s*(?:ÀS|AS|-)\s*(\d{2}:\d{2})/i
          );

        if (match) {
          inicio = match[1];
          fim = match[2];
          periodoNode = node;
          break;
        }

        node = node.parentElement;
      }

      const totalDiaInput =
        dayNode?.querySelector(
          'input[name^="QuantidadeSemana"]'
        );

      const totalPeriodoInput =
        periodoNode?.querySelector(
          'input[name="Total"]'
        );

      registros.push({
        inicio,
        fim,
        dia,
        categoria,
        quantidade: Number(input.value) || 0,
        totalDia: totalDiaInput
          ? Number(totalDiaInput.value) || 0
          : null,
        totalPeriodo: totalPeriodoInput
          ? Number(totalPeriodoInput.value) || 0
          : null
      });
    }

    return registros.filter(item =>
      item.inicio &&
      item.fim &&
      item.dia &&
      item.categoria
    );
  });
}

function estruturarGrade(registros) {
  const periodos = {};

  for (const registro of registros) {

    const periodo =
      `${registro.inicio}-${registro.fim}`;

    if (!periodos[periodo]) {
      periodos[periodo] = {
        inicio: registro.inicio,
        fim: registro.fim,
        totalPeriodo: registro.totalPeriodo,
        dias: {}
      };
    }

    if (!periodos[periodo].dias[registro.dia]) {
      periodos[periodo].dias[registro.dia] = {
        total: registro.totalDia,
        categorias: {}
      };
    }

    periodos[periodo]
      .dias[registro.dia]
      .categorias[registro.categoria] =
        registro.quantidade;
  }

  return {
    quantidadeRegistros: registros.length,
    periodos
  };
}

async function main() {

  console.log('');
  console.log('JBS Grade Collector');
  console.log('Gate Principal');
  console.log('');

  let browser;

  try {

    browser = await chromium.launch({
      headless: HEADLESS
    });

    const contextOptions = {};

    if (fs.existsSync(AUTH_FILE)) {
      contextOptions.storageState = AUTH_FILE;

      console.log(
        'Tentando reutilizar sessão anterior.'
      );
    }

    const context =
      await browser.newContext(contextOptions);

    const page =
      await context.newPage();

    page.setDefaultTimeout(30000);

    await abrirGrade(page);

    await context.storageState({
      path: AUTH_FILE
    });

    console.log(
      'Extraindo Gate Principal...'
    );

    const registros =
      await extrairGrade(page);

    console.log(
      `${registros.length} registros encontrados.`
    );

    const resultado = {
      coletadoEm: agoraISO(),
      origem: GRADE_URL,
      gate: 'GATE PRINCIPAL',
      grade: estruturarGrade(registros)
    };

    const latest =
      path.join(
        OUTPUT_DIR,
        'grade-latest.json'
      );

    const historico =
      path.join(
        OUTPUT_DIR,
        `grade-${nomeArquivoTimestamp()}.json`
      );

    const json =
      JSON.stringify(resultado, null, 2);

    fs.writeFileSync(
      latest,
      json,
      'utf8'
    );

    fs.writeFileSync(
      historico,
      json,
      'utf8'
    );

    console.log('');
    console.log('Coleta concluída.');
    console.log(`Arquivo atual: ${latest}`);
    console.log(`Histórico: ${historico}`);

  } catch (erro) {

    console.error('');
    console.error('ERRO NA COLETA');
    console.error(erro);

    process.exitCode = 1;

  } finally {

    if (browser) {
      await browser.close();
    }
  }
}

main();
