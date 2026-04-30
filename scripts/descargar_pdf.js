const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const nit = process.argv[2];
const indice = parseInt(process.argv[3]);
const nombre_archivo = process.argv[4];
const usuario = process.env.SIESA_USUARIO;
const password = process.env.SIESA_PASSWORD;

const ahora = new Date();
const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
const fechaDesde = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
const fechaHasta = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ─── LOGIN ────────────────────────────────────────────────────────────────
  await page.goto('https://portalfe.siesacloud.com/smart4b/#/login');
  await page.getByRole('textbox', { name: 'Usuario' }).fill(usuario);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForTimeout(8000);

  // ─── NAVEGACIÓN ───────────────────────────────────────────────────────────
  await page.getByText('Recepción', { exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Recepción De Documentos De').click();
  await page.waitForTimeout(5000);

  // ─── FILTROS ──────────────────────────────────────────────────────────────
  await page.getByRole('textbox', { name: 'Nit Emisor' }).fill(nit);
  await page.getByRole('textbox', { name: 'Nit Emisor' }).press('Tab');
  await page.locator('input#fechaDesde').fill(fechaDesde);
  await page.locator('input#fechaDesde').press('Tab');
  await page.locator('input#fechaHasta').fill(fechaHasta);
  await page.locator('input#fechaHasta').press('Tab');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.waitForTimeout(7000);

  // ─── VALIDAR ÍNDICE ───────────────────────────────────────────────────────
  const toggleButtons = page.locator('button.dropdown-toggle');
  const count = await toggleButtons.count();
  console.log(`Filas encontradas: ${count}, usando índice: ${indice}`);

  if (indice >= count) {
    throw new Error(`Índice ${indice} fuera de rango. Solo hay ${count} filas.`);
  }

  // ─── INTERCEPTAR PDF ANTES DE HACER CLIC ─────────────────────────────────
  let pdfBase64 = null;
  let pdfResolve;
  const pdfPromise = new Promise(resolve => { pdfResolve = resolve; });

  context.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (
      (url.includes('pdf-recepcion') || contentType.includes('application/pdf')) &&
      response.status() === 200
    ) {
      try {
        const buffer = await response.body();
        if (buffer.length > 1000) {
          pdfBase64 = buffer.toString('base64');
          console.log(`PDF interceptado: ${buffer.length} bytes`);
          pdfResolve(true);
        }
      } catch (e) {
        console.log('Error leyendo respuesta:', e.message);
      }
    }
  });

  // ─── ABRIR DROPDOWN ───────────────────────────────────────────────────────
  await toggleButtons.nth(indice).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Cerrar cualquier dropdown previo
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await toggleButtons.nth(indice).click();
  await page.waitForTimeout(1000);

  // ─── BUSCAR "Ver PDF" EN EL BODY (append-to-body) ────────────────────────
  // El ul se inyecta directamente en el body
  const menu = page.locator('body > ul.dropdown-menu a, body ul.wf-action-menu a').filter({ hasText: 'Ver PDF' });

  // Si no está en body directo, buscar en cualquier dropdown abierto
  const verPdf = page.locator('a.dropdown-drop').filter({ hasText: 'Ver PDF' }).first();

  let clicked = false;

  // Intento 1: menú en body
  try {
    await menu.first().waitFor({ state: 'visible', timeout: 4000 });
    await menu.first().click();
    console.log('Clic via menú body');
    clicked = true;
  } catch (e) {
    console.log('Menú body no visible, intentando fallback...');
  }

  // Intento 2: locator directo con evaluate para forzar clic via JS
  if (!clicked) {
    try {
      await page.evaluate((idx) => {
        const links = Array.from(document.querySelectorAll('a.dropdown-drop'));
        const verPdfLinks = links.filter(a => a.textContent.trim() === 'Ver PDF');
        if (verPdfLinks[0]) verPdfLinks[0].click();
      }, indice);
      console.log('Clic via evaluate JS');
      clicked = true;
    } catch (e) {
      console.log('Evaluate falló:', e.message);
    }
  }

  if (!clicked) {
    await page.screenshot({ path: 'output/debug.png', fullPage: true });
    throw new Error('No se pudo hacer clic en Ver PDF');
  }

  // ─── ESPERAR PDF (máx 20 segundos) ───────────────────────────────────────
  await Promise.race([
    pdfPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando PDF')), 20000))
  ]);

  // ─── GUARDAR ──────────────────────────────────────────────────────────────
  if (!fs.existsSync('output')) fs.mkdirSync('output');

  if (!pdfBase64) {
    await page.screenshot({ path: 'output/debug.png', fullPage: true });
    throw new Error('PDF no capturado');
  }

  fs.writeFileSync(
    path.join('output', nombre_archivo + '.pdf'),
    Buffer.from(pdfBase64, 'base64')
  );

  console.log(`OK — PDF guardado: ${nombre_archivo}.pdf`);
  await browser.close();
})();
