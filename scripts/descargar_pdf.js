const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const nit = process.argv[2];
const indice = parseInt(process.argv[3]);
const usuario = process.env.USUARIO;
const password = process.env.PASSWORD;

const ahora = new Date();
const primerDia = '1';
const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate().toString();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://portalfe.siesacloud.com/smart4b/#/login');
  await page.getByRole('textbox', { name: 'Usuario' }).fill(usuario);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForTimeout(8000);
  
  await page.getByText('Recepción', { exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Recepción De Documentos De').click();
  await page.waitForTimeout(5000);

  await page.getByRole('textbox', { name: 'Nit Emisor' }).fill(nit);

await page.getByRole('button', { name: 'fa fa-home' }).first().click();
await page.waitForTimeout(2000);
await page.locator('button.day, td.day, .datepicker td').filter({ hasText: new RegExp('^' + primerDia + '$') }).first().click();

await page.getByRole('button', { name: 'fa fa-home' }).nth(1).click();
await page.waitForTimeout(2000);
await page.locator('button.day, td.day, .datepicker td').filter({ hasText: new RegExp('^' + ultimoDia + '$') }).first().click();

  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.waitForTimeout(3000);

  await page.getByRole('button', { name: ' Toggle Dropdown' }).nth(indice).click();
  await page.waitForTimeout(1000);

  let pdfBase64 = null;

  context.on('response', async response => {
    if (
      response.url().includes('pdf-recepcion') &&
      response.status() === 200
    ) {
      const buffer = await response.body();
      pdfBase64 = buffer.toString('base64');
    }
  });

  const page1Promise = page.waitForEvent('popup');
  await page.getByText('Ver PDF').nth(indice + 1).click();
  const page1 = await page1Promise;
  await page1.waitForTimeout(4000);

  if (!pdfBase64) {
    const iframeElement = await page1.locator('iframe').elementHandle();
    const iframe = await iframeElement.contentFrame();
    const downloadPromise = page1.waitForEvent('download');
    await iframe.getByRole('button', { name: 'Descargar' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    pdfBase64 = Buffer.concat(chunks).toString('base64');
  }

  // Guardar en carpeta output para que GitHub Actions lo suba como artefacto
  if (!fs.existsSync('output')) fs.mkdirSync('output');
  const nombreArchivo = `N_${nit}_FV_${indice}_${ahora.toISOString().split('T')[0].replace(/-/g,'')}.pdf`;
  fs.writeFileSync(path.join('output', nombreArchivo), Buffer.from(pdfBase64, 'base64'));
  console.log(nombreArchivo);

  await browser.close();
})();
