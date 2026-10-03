/** Sequential timezone runs with a failure status that survives the summary. */
import { execFileSync } from 'node:child_process'
const zones=['Europe/Berlin','America/New_York','Australia/Sydney','America/Santiago','Pacific/Auckland']
for(const TZ of zones) {
  try {
    const output=execFileSync(process.execPath,['tests/run.mjs'],{env:{...process.env,TZ},encoding:'utf8',maxBuffer:4*1024*1024})
    if(!output.includes('Все тесты пройдены.')) throw new Error('Нет подтверждения завершения набора')
    console.log(`${TZ.padEnd(22)}Все тесты пройдены.`)
  } catch(error) {
    process.exitCode=1
    console.error(`${TZ.padEnd(22)}ПРОВАЛЕНО`)
    const output=String(error.stdout??error.message)
    console.error(output.split('\n').filter(line=>/FAIL|Error|ПРОВАЛЕНО/.test(line)).slice(-12).join('\n')||output.slice(-1000))
  }
}
