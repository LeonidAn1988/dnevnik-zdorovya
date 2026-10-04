import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {seed,settleAny,FROZEN,go} from './visual.mjs'
import {seedEvolution,evolutionData} from './evolution-scenarios.mjs'
const OUT='reviews/evidence/evolution-ui';mkdirSync(OUT,{recursive:true})
const browser=await chromium.launch(),checks=[],errors=[]
try {
 for(const scale of ['normal','xlarge'])for(const theme of ['light','dark']) {
  const p=await (await browser.newContext({viewport:{width:360,height:780},hasTouch:true,locale:'ru-RU'})).newPage()
  p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(String(e)))
  await p.route('https://api.github.com/**',r=>r.fulfill({body:'[]',contentType:'application/json'}))
  await p.clock.install({time:new Date(FROZEN)});await p.goto('http://localhost:5199');await settleAny(p);await seed(p,FROZEN);await seedEvolution(p,FROZEN,{textScale:scale,theme})
  const prefix=`${scale}-${theme}`,check=n=>{checks.push(`${prefix}: ${n}`);console.log(`ok ${prefix}: ${n}`)}
  const snap=async n=>{assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${prefix}-${n}: overflow`);await p.screenshot({path:`${OUT}/${prefix}-${n}.png`,fullPage:true})}
  const stock=async()=>go(p,{tab:'Аптечка',section:'Запасы'})
  const save=async()=>{await p.getByRole('button',{name:'Сохранить',exact:true}).first().click();await p.waitForTimeout(450)}
  await stock();await p.locator('.pill__open',{hasText:'Пепсан · тест'}).click()
  assert.equal(await p.locator('details[open]').count(),0);assert.match(await p.locator('body').innerText(),/08:00 и 20:00 ещё 14 дней/)
  await snap('card');await p.locator('summary',{hasText:'Подробности препарата'}).click();assert(await p.getByText('Тестовый производитель',{exact:true}).isVisible());check('compact card reveals secondary details')
  await p.getByRole('button',{name:'Курс приёма',exact:true}).click()
  const stage=p.locator('details').filter({has:p.locator('summary',{hasText:'Курс по этапам'})})
  assert.equal(await stage.locator('.card').count(),2)
  await stage.locator('.card').nth(1).getByRole('button',{name:/Вечером/}).click()
  await stage.locator('.card').nth(1).getByRole('button',{name:/Вечером/}).click()
  await p.getByLabel('За сколько минут до еды',{exact:true}).fill('20');await snap('stages');await save()
  const c=(await evolutionData(p,'regimens')).find(x=>x.id==='before');assert.deepEqual(c.plan[1].times,['08:00']);assert.equal(c.mealMinutes,20);check('14×2 + 30×1 stages and meal interval saved')
  await go(p,{tab:'Приём'});const row=p.locator('.dose').filter({hasText:'Пепсан · тест'}).first()
  // Match the actual intake control by its accessible name.
  await row.getByRole('button',{name:'Принял',exact:true}).click()
  await p.getByRole('button',{name:/Таймер до еды/}).first().click();await p.waitForTimeout(400)
  await p.getByRole('button',{name:/Закончил есть/}).first().click();await p.waitForTimeout(400)
  let st=await evolutionData(p);assert.equal(st.mealTimers.length,2);assert.deepEqual(st.mealTimers.map(t=>(t.dueAt-t.startedAt)/60000).sort((a,b)=>a-b),[20,30]);assert.equal(await p.getByRole('button',{name:'Таймер запущен',exact:true}).count(),2)
  await snap('timers');await p.reload();await p.locator('.app').waitFor();await go(p,{tab:'Приём'});st=await evolutionData(p);assert.equal(st.mealTimers.length,2);check('two explicit timers persist, duplicates disabled')
  assert.equal(await p.locator('.dose').filter({hasText:'Капли · тест'}).first().locator('.dose__late').count(),0);assert(await p.getByRole('button',{name:'Отменить таймер',exact:true}).first().evaluate(e=>e.getBoundingClientRect().height>=48));check('waiting interval has no conflicting overdue label; cancel target ≥48px')
  await p.getByRole('button',{name:/Уведомления/}).click();await p.getByRole('dialog',{name:'История уведомлений'}).waitFor();await snap('history');await p.getByRole('dialog').getByRole('button',{name:'Назад',exact:true}).click();check('notification history opens and closes')
  await p.getByRole('button',{name:'Отменить таймер',exact:true}).first().click();assert.equal((await evolutionData(p)).mealTimers.filter(t=>!t.cancelledAt).length,1);check('timer cancellation saved')
  await stock();await p.locator('.pill__open',{hasText:'Капли · тест'}).click();assert.match(await p.locator('body').innerText(),/расход суммируется/);assert(await p.getByRole('button',{name:/Борис.*20:00/}).count());check('shared stock identifies each owner')
  await p.getByRole('button',{name:'Изменить',exact:true}).click();assert.equal(await p.getByLabel('Запас измеряется в',{exact:true}).inputValue(),'ml');await p.getByLabel('Расход за приём в',{exact:true}).selectOption('drop');assert.equal(await p.getByLabel('Капель в 1 мл',{exact:true}).inputValue(),'40');await snap('drops');await p.getByRole('button',{name:'Отмена',exact:true}).first().click()
  await stock();await p.getByRole('group',{name:'Разделы аптечки'}).getByRole('button',{name:/Купить/}).click();assert.equal(await p.locator('.pill__open',{hasText:'Резерв без курса'}).count(),0);check('uncoursed empty reserve excluded from purchases')
  await go(p,{tool:'Настройки'});await p.locator('.pill__open',{hasText:'Напоминания'}).click();await p.locator('summary',{hasText:'Когда предупреждать о запасах аптечки'}).click();await p.getByLabel('До конца запаса, дней',{exact:true}).fill('14');await p.getByRole('button',{name:'До конца запаса, дней: увеличить',exact:true}).click();await p.waitForTimeout(400);assert.equal((await evolutionData(p)).supplyWarningDays,15);await snap('warning-settings');check('global warning and stepper persist')
  await stock();await p.locator('.cabinet__add').click();await p.getByLabel('Искать по',{exact:true}).selectOption('name');await p.getByRole('combobox',{name:'Название или поиск препарата',exact:true}).fill('пепсан');await p.getByRole('option').filter({hasText:'ПЕПСАН'}).first().click();await p.getByRole('group',{name:'Формы выпуска из реестра'}).getByRole('button',{name:'Гель для приема внутрь',exact:true}).click();assert.equal(await p.getByLabel('Запас измеряется в',{exact:true}).inputValue(),'sachet');assert.equal(await p.getByLabel('Расход за приём в',{exact:true}).inputValue(),'sachet');await snap('sachets');check('real registry Pepsan oral gel defaults to sachets')
  for(const [field,query] of [['maker','майоли'],['inn','диметикон'],['form','гель']]) {await p.getByLabel('Искать по',{exact:true}).selectOption(field);await p.locator('.suggest input').fill(query);await p.locator('[role=option]').first().waitFor();assert(await p.locator('[role=option]').count());check(`search by ${field} finds registry matches`)}
  await p.getByRole('button',{name:'Отмена',exact:true}).first().click()
  await p.context().close()
 }
 assert.equal(errors.length,0)
} finally {writeFileSync(`${OUT}/checks.json`,JSON.stringify({checks,errors},null,2));await browser.close()}
