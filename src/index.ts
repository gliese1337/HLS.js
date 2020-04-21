import { transmux } from './transmux';
import fs from 'fs';

const tsdata = new Uint8Array(fs.readFileSync(process.argv[2]));
const mp4data = transmux(tsdata);
fs.writeFileSync('test.mp4', mp4data);