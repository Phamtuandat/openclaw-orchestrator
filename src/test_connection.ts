import { getOpenClawClient } from './core/openclaw_client';

async function testConnection() {
  console.log('Testing OpenClaw WS connection with device auth...');
  const client = getOpenClawClient();

  try {
    await client.connect();
    console.log('✅ Connected and authenticated!');

    const result = await client.sendRequest('system.version', {}, 5000);
    console.log('Gateway version:', result);

    const agents = await client.sendRequest('agents.list', {}, 5000);
    console.log('Agents:', agents);

  } catch (err: any) {
    console.error('❌ Connection failed:', err.message);
  } finally {
    client.disconnect();
  }
}

testConnection();
