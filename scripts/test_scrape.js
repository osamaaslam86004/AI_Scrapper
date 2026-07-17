const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function run(){
  const port = process.env.PORT || 3000;
  const res = await fetch(`http://localhost:${port}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://news.ycombinator.com/',
      userQuery: 'Extract top 3 articles with their titles and source links'
    })
  });

  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', text);
}

run().catch(err=>{ console.error(err); process.exit(1); });
