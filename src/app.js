#!/usr/bin/env node
import { createRadarServer } from './appServer.js';

const rawPort = Number.parseInt(process.env.OPENJOB_RADAR_PORT || '4174', 10);
const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65_536 ? rawPort : 4174;
const host = '127.0.0.1';
const server = createRadarServer();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`${host}:${port} 포트를 이미 사용 중입니다. OPENJOB_RADAR_PORT로 다른 포트를 지정하세요.`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`OpenJob Radar 로컬 관리 화면: http://${host}:${port}`);
  console.log('이 창을 닫으면 관리 화면도 종료됩니다. 수집은 화면의 버튼을 눌렀을 때만 실행됩니다.');
});
