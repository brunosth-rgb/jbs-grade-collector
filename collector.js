const { chromium } = require('playwright');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

dotenv.config({ quiet: true });

const BASE_URL = 'https://' + 'portal.jbsterminais.com.br';
const GRADE_URL = BASE_URL + '/grade-agendamento';

const USER = process.env.PORTAL_USER;
const PASSWORD = process.env.PORTAL_PASSWORD;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

const HEADLESS =
  String(process.env.HEADLESS ?? 'false').toLowerCase() === 'true';

const ROOT_DIR = __dirname;

const AUTH_DIR =
  path.join(ROOT_DIR, '.auth');

const OUTPUT_DIR =
  path.join(ROOT_DIR, 'output');

const CREDENTIALS_DIR =
  path.join(ROOT_DIR, 'credentials');

const AUTH_FILE =
  path.join(AUTH_DIR, 'portal.json');

const SERVICE_ACCOUNT_FILE =
  path.join(
    CREDENTIALS_DIR,
    'firebase-service-account.json'
  );

fs.mkdirSync(AUTH_DIR, {
  recursive: true
});

fs.mkdirSync(OUTPUT_DIR, {
  recursive: true
});

if (!USER || !PASSWORD) {
  console.error(
    'ERRO: PORTAL_USER e PORTAL_PASSWORD não definidos no .env'
  );
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error(
    'ERRO: FIREBASE_DATABASE_URL não definido no .env'
  );
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
  console.error(
    'ERRO: arquivo credentials/firebase-service-account.json não encontrado'
  );
  process.exit(1);
}


/* =========================================================
   FIREBASE
   ========================================================= */

const serviceAccount =
  require(SERVICE_ACCOUNT_FILE);

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: DATABASE_URL
});

const db = getDatabase(firebaseApp);


/* =========================================================
   UTILIDADES
   ========================================================= */

function agoraISO() {
  return new Date().toISOString();
}

function timestampArquivo() {
  return new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');
}

function obterSemanaBrasil() {
  const agora = new Date();

  const partes = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(agora);

  const valores = {};

  for (const parte of partes) {
    if (parte.type !== 'literal') {
      valores[parte.type] = parte.value;
    }
  }

  const ano = Number(valores.year);
  const mes = Number(valores.month);
  const dia = Number(valores.day);

  const hoje = new Date(
    Date.UTC(
      ano,
      mes - 1,
      dia
    )
  );

  const diaSemana = hoje.getUTCDay();

  const deslocamentoSegunda =
    diaSemana === 0
      ? -6
      : 1 - diaSemana;

  const segunda = new Date(hoje);

  segunda.setUTCDate(
    hoje.getUTCDate() +
    deslocamentoSegunda
  );

  const nomes = [
    'Seg',
    'Ter',
    'Qua',
    'Qui',
    'Sex',
    'Sáb',
    'Dom'
  ];

  const dias = {};

  for (let i = 0; i < 7; i++) {
    const data = new Date(segunda);

    data.setUTCDate(
      segunda.getUTCDate() + i
    );

    dias[nomes[i]] =
      data
        .toISOString()
        .slice(0, 10);
  }

  return {
    inicio: dias.Seg,
    fim: dias.Dom,
    dias
  };
}

function dataHoraBrasil() {
  const agora = new Date();

  const formatadorData =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    );

  const formatadorHora =
    new Intl.DateTimeFormat(
      'pt-BR',
      {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }
    );

  const data =
    formatadorData.format(agora);

  const hora =
    formatadorHora
      .format(agora)
      .replace(/:/g, '-');

  return {
    data,
    hora
  };
}


/* =========================================================
   LOGIN
   ========================================================= */

async function precisaLogin(page) {

  if (
    page.url()
      .toLowerCase()
      .includes('/login')
  ) {
    return true;
  }

  return (
    await page
      .locator('input[type="password"]')
      .count()
  ) > 0;
}


async function primeiroVisivel(
  page,
  seletores
) {

  for (const seletor of seletores) {

    const locator =
      page.locator(seletor);

    const quantidade =
      await locator.count();

    for (
      let i = 0;
      i < quantidade;
      i++
    ) {

      const item =
        locator.nth(i);

      try {

        if (
          await item.isVisible()
        ) {
          return item;
        }

      } catch (_) {}
    }
  }

  return null;
}


async function fazerLogin(page) {

  console.log(
    'Realizando login no Portal JBS...'
  );

  await page.goto(
    BASE_URL + '/login',
    {
      waitUntil:
        'domcontentloaded',

      timeout:
        60000
    }
  );

  await page.waitForTimeout(
    2500
  );

  const usuario =
    await primeiroVisivel(
      page,
      [
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
      ]
    );

  const senha =
    await primeiroVisivel(
      page,
      [
        'input[type="password"]',
        'input[name*="senha" i]',
        'input[name*="password" i]'
      ]
    );

  if (!usuario) {
    throw new Error(
      'Campo de usuário não encontrado.'
    );
  }

  if (!senha) {
    throw new Error(
      'Campo de senha não encontrado.'
    );
  }

  await usuario.fill(USER);
  await senha.fill(PASSWORD);

  const candidatos = [

    page.getByRole(
      'button',
      {
        name: /entrar/i
      }
    ),

    page.getByRole(
      'button',
      {
        name: /acessar/i
      }
    ),

    page.getByRole(
      'button',
      {
        name: /login/i
      }
    ),

    page.locator(
      'button[type="submit"]'
    ),

    page.locator(
      'input[type="submit"]'
    )
  ];

  let botao = null;

  for (
    const candidato
    of candidatos
  ) {

    const quantidade =
      await candidato.count();

    for (
      let i = 0;
      i < quantidade;
      i++
    ) {

      const item =
        candidato.nth(i);

      try {

        if (
          await item.isVisible()
        ) {

          botao = item;
          break;
        }

      } catch (_) {}
    }

    if (botao) {
      break;
    }
  }

  if (!botao) {

    throw new Error(
      'Botão de login não encontrado.'
    );
  }

  await botao.click();

  try {

    await page.waitForURL(
      url =>
        !url
          .toString()
          .toLowerCase()
          .includes('/login'),
      {
        timeout: 60000
      }
    );

  } catch (_) {

    await page.waitForTimeout(
      3000
    );

    if (
      await precisaLogin(page)
    ) {

      throw new Error(
        'Login não concluído. Verifique usuário e senha.'
      );
    }
  }

  console.log(
    'Login realizado.'
  );
}


/* =========================================================
   GRADE
   ========================================================= */

async function esperarGrade(page) {

  await page.waitForFunction(
    () => {

      return (
        document
          .querySelectorAll(
            '.bg-sky-200.rounded'
          )
          .length >= 24
        &&
        document
          .querySelectorAll(
            'input[name="_value"]'
          )
          .length > 0
      );

    },
    null,
    {
      timeout: 60000
    }
  );
}


async function abrirGrade(page) {

  console.log(
    'Abrindo Grade de Agendamento...'
  );

  await page.goto(
    GRADE_URL,
    {
      waitUntil:
        'domcontentloaded',

      timeout:
        60000
    }
  );

  if (
    await precisaLogin(page)
  ) {

    await fazerLogin(page);

    await page.goto(
      GRADE_URL,
      {
        waitUntil:
          'domcontentloaded',

        timeout:
          60000
      }
    );
  }

  const gatePrincipal =
    page.getByText(
      'GATE PRINCIPAL',
      {
        exact: true
      }
    );

  if (
    await gatePrincipal.count()
  ) {

    try {

      if (
        await gatePrincipal
          .first()
          .isVisible()
      ) {

        await gatePrincipal
          .first()
          .click();

        await page.waitForTimeout(
          750
        );
      }

    } catch (_) {}
  }

  await esperarGrade(page);

  console.log(
    'Grade carregada.'
  );
}


/* =========================================================
   EXTRAÇÃO
   ========================================================= */

async function extrairGrade(page) {

  return await page.evaluate(
    () => {

      function limparCategoria(
        texto
      ) {

        return String(
          texto || ''
        )
          .replace(
            /\([^)\]]*[\)\]]/g,
            ''
          )
          .replace(
            /\[\+?-?\d+\]/g,
            ''
          )
          .replace(
            /\s+/g,
            ' '
          )
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

      const registros = [];

      const blocosHorario = [
        ...document
          .querySelectorAll(
            '.bg-sky-200.rounded'
          )
      ];

      for (
        const horarioEl
        of blocosHorario
      ) {

        const textoHorario =
          horarioEl
            .innerText
            ?.trim()
            .replace(
              /\s+/g,
              ' '
            ) || '';

        const horario =
          textoHorario.match(
            /(\d{2}:\d{2})\s*(?:ÀS|AS)\s*(\d{2}:\d{2})/i
          );

        if (!horario) {
          continue;
        }

        const inicio =
          horario[1];

        const fim =
          horario[2];

        let container =
          horarioEl;

        let nivel = 0;

        while (
          container &&
          container !==
            document.body &&
          nivel < 10
        ) {

          const quantidade =
            container
              .querySelectorAll(
                'input[name="_value"]'
              )
              .length;

          if (
            quantidade > 0
          ) {
            break;
          }

          container =
            container
              .parentElement;

          nivel++;
        }

        if (
          !container ||
          container ===
            document.body
        ) {

          continue;
        }

        const inputs = [
          ...container
            .querySelectorAll(
              'input[name="_value"]'
            )
        ];

        const totalPeriodoInput =
          container
            .querySelector(
              'input[name="Total"]'
            );

        const totalPeriodo =
          totalPeriodoInput
            ? Number(
                totalPeriodoInput.value
              ) || 0
            : null;

        for (
          const input
          of inputs
        ) {

          const textoCategoria =
            input
              .parentElement
              ?.innerText
              ?.trim()
              .replace(
                /\s+/g,
                ' '
              ) || '';

          const categoria =
            limparCategoria(
              textoCategoria
            );

          if (!categoria) {
            continue;
          }

          let node =
            input;

          let dia = '';
          let dayNode =
            null;

          while (
            node &&
            node !== container
          ) {

            const classeDia =
              [...node.classList]
                .map(
                  classe =>
                    classe
                      .toLowerCase()
                )
                .find(
                  classe =>
                    dias[classe]
                );

            if (
              classeDia
            ) {

              dia =
                dias[
                  classeDia
                ];

              dayNode =
                node;

              break;
            }

            node =
              node.parentElement;
          }

          if (
            !dia ||
            !dayNode
          ) {

            continue;
          }

          const totalDiaInput =
            dayNode
              .querySelector(
                'input[name^="QuantidadeSemana"]'
              );

          const totalDia =
            totalDiaInput
              ? Number(
                  totalDiaInput.value
                ) || 0
              : null;

          registros.push({
            inicio,
            fim,
            dia,
            categoria,

            quantidade:
              Number(
                input.value
              ) || 0,

            totalDia,
            totalPeriodo
          });
        }
      }


      const unicos =
        new Map();

      for (
        const item
        of registros
      ) {

        const chave =
          [
            item.inicio,
            item.fim,
            item.dia,
            item.categoria
          ].join('|');

        unicos.set(
          chave,
          item
        );
      }

      return [
        ...unicos.values()
      ];
    }
  );
}


/* =========================================================
   ESTRUTURAÇÃO
   ========================================================= */

function estruturarGrade(
  registros
) {

  const periodos = {};

  for (
    const registro
    of registros
  ) {

    const periodo =
      `${registro.inicio}-${registro.fim}`;

    if (
      !periodos[periodo]
    ) {

      periodos[
        periodo
      ] = {

        inicio:
          registro.inicio,

        fim:
          registro.fim,

        totalPeriodo:
          registro.totalPeriodo,

        dias: {}
      };
    }

    if (
      !periodos[
        periodo
      ].dias[
        registro.dia
      ]
    ) {

      periodos[
        periodo
      ].dias[
        registro.dia
      ] = {

        total:
          registro.totalDia,

        categorias: {}
      };
    }

    periodos[
      periodo
    ]
      .dias[
        registro.dia
      ]
      .categorias[
        registro.categoria
      ] =
        registro.quantidade;
  }

  return {

    quantidadeRegistros:
      registros.length,

    quantidadePeriodos:
      Object
        .keys(
          periodos
        )
        .length,

    periodos
  };
}


/* =========================================================
   FIREBASE
   ========================================================= */

async function publicarFirebase(
  resultado
) {

  console.log('');
  console.log(
    'Publicando no Firebase...'
  );

  const {
    data,
    hora
  } =
    dataHoraBrasil();

  await db
    .ref(
      'gradeAtual'
    )
    .set(
      resultado
    );

  console.log(
    'gradeAtual atualizado.'
  );

  await db
    .ref(
      `historicoGrade/${data}/${hora}`
    )
    .set(
      resultado
    );

  console.log(
    `Histórico salvo em ${data}/${hora}.`
  );
}


/* =========================================================
   EXECUÇÃO
   ========================================================= */

async function main() {

  console.log('');
  console.log(
    'JBS Grade Collector'
  );
  console.log(
    'Gate Principal'
  );
  console.log('');

  let browser;

  try {

    browser =
      await chromium.launch(
        {
          headless:
            HEADLESS
        }
      );

    const contextOptions = {

      viewport: {
        width: 1600,
        height: 1000
      }
    };

    if (
      fs.existsSync(
        AUTH_FILE
      )
    ) {

      contextOptions
        .storageState =
        AUTH_FILE;

      console.log(
        'Tentando reutilizar sessão anterior.'
      );
    }

    const context =
      await browser
        .newContext(
          contextOptions
        );

    const page =
      await context
        .newPage();

    page
      .setDefaultTimeout(
        30000
      );

    await abrirGrade(
      page
    );

    await context
      .storageState(
        {
          path:
            AUTH_FILE
        }
      );

    console.log(
      'Extraindo Gate Principal...'
    );

    const registros =
      await extrairGrade(
        page
      );

    if (
      registros.length === 0
    ) {

      throw new Error(
        'Nenhum registro encontrado na grade.'
      );
    }

    const grade =
      estruturarGrade(
        registros
      );

    console.log(
      `${grade.quantidadeRegistros} registros encontrados.`
    );

    console.log(
      `${grade.quantidadePeriodos} períodos encontrados.`
    );

    if (
      grade.quantidadePeriodos
      !== 24
    ) {

      throw new Error(
        `Coleta incompleta: ${grade.quantidadePeriodos} períodos encontrados.`
      );
    }

    const resultado = {

      coletadoEm:
        agoraISO(),

      origem:
        GRADE_URL,

      gate:
        'GATE PRINCIPAL',

      status:
        'OK',

      semana:
        obterSemanaBrasil(),

      grade
    };

    const latest =
      path.join(
        OUTPUT_DIR,
        'grade-latest.json'
      );

    const historico =
      path.join(
        OUTPUT_DIR,
        `grade-${timestampArquivo()}.json`
      );

    const json =
      JSON.stringify(
        resultado,
        null,
        2
      );

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
    console.log(
      'JSON local criado.'
    );

    await publicarFirebase(
      resultado
    );

    console.log('');
    console.log(
      'Coleta concluída com sucesso.'
    );

    console.log(
      `Arquivo atual: ${latest}`
    );

    console.log(
      `Histórico local: ${historico}`
    );

  } catch (erro) {

    console.error('');
    console.error(
      'ERRO NA COLETA'
    );

    console.error(
      erro.stack ||
      erro.message ||
      erro
    );

    process.exitCode = 1;

  } finally {

    if (browser) {

      await browser
        .close();
    }

    try {
      await deleteApp(firebaseApp);
    } catch (_) {}
  }
}

main();
