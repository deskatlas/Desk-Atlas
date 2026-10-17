// MS64-TC01/05/08/15: mount tests/fixtures/ms64-knowledge-browser.tsx at /ms64-fixture on port 3064.
const { chromium } = require(process.env.MS64_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve('outputs/ms64-browser');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [1440,390]){
   for(const state of ['empty','processing','failed','replacement']){
    const page=await browser.newPage({viewport:{width,height:width===1440?900:844}});
    page.setDefaultTimeout(15000);
    await page.goto(`${process.env.MS64_BASE_URL || 'http://127.0.0.1:3064'}/ms64-fixture?state=${state}`);
    const open=page.getByRole('button',{name:'Upload document',exact:true});
    await open.waitFor();
    await page.waitForFunction(()=>!document.querySelector('button[disabled]'));
    if(state!=='empty') await page.getByRole('heading',{name:'Operating guide'}).waitFor();
    await page.screenshot({path:path.join(out,`${width}-${state}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(state==='failed') await page.getByText('Upload an unlocked copy of this file.').waitFor();
    if(state==='empty'||state==='replacement'){
     if(state==='replacement'){
      await page.getByText('Document actions',{exact:true}).click();
      await page.getByRole('button',{name:'Upload replacement',exact:true}).click();
     }else await open.click();
     const dialog=page.getByRole('dialog');
     assert.equal(await dialog.getByRole('textbox',{name:'File name',exact:true}).count(),1);
     assert.equal(await dialog.getByRole('checkbox').count(),0);
     assert.equal(await dialog.getByRole('button',{name:/publish/i}).count(),0);
     assert.equal(await page.getByLabel('Who can use this document?').inputValue(),state==='replacement'?'ADMIN_AND_STAFF':'ADMIN_ONLY');
     assert.equal(await dialog.locator('input[type=file]').count(),1);
     await dialog.getByLabel('File',{exact:true}).setInputFiles({name:'guide.md',mimeType:'text/markdown',buffer:Buffer.from('Only authorized staff may check in.')});
     const name=dialog.getByRole('textbox',{name:'File name',exact:true});
     assert.equal(await name.inputValue(),state==='replacement'?'Operating guide':'guide');
     await name.fill('   ');
     assert.equal(await dialog.getByRole('button',{name:'Upload',exact:true}).isDisabled(),true);
     await name.fill('Staff operating guide');
     await page.screenshot({path:path.join(out,`${width}-${state}-upload.png`),fullPage:true});
     // Native dialog keeps keyboard focus inside the modal.
     for(let i=0;i<8;i++){
      await page.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
     }
     await dialog.getByRole('button',{name:'Upload',exact:true}).click();
     const payload=JSON.parse(await page.locator('html').getAttribute('data-last-upload'));
     assert.equal(payload.title,'Staff operating guide');
     assert.equal(payload.filename,'guide.md');
     await page.getByRole('status').filter({hasText:'Processing.'}).waitFor();
     assert.equal(await dialog.isVisible(),false);
     assert.equal(await open.evaluate(el=>el===document.activeElement),true);
     await page.screenshot({path:path.join(out,`${width}-${state}-accepted.png`),fullPage:true});
    }
    await page.close();
   }
  }
  console.log('MS64 desktop/mobile: simple upload, audience defaults/prefill, accepted processing, replacement, failure, focus trap/restoration, no overflow passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
