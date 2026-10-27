import { sendNightlyCard } from '../../lib/line.mjs';

// 21:00 Asia/Taipei
export default async () => {
  console.log(await sendNightlyCard());
};

export const config = { schedule: '0 13 * * *' };
