import { scrape } from '../dist/index.js';
const result = await scrape('search', { query: 'wireless headphones', limit: 5 });
console.log(JSON.stringify(result, null, 2));
