const cheerio = require('cheerio');

(async () => {
  try {
    const res = await fetch('https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      }
    });

    const html = await res.text();
    const $ = cheerio.load(html);

    console.log('--- INSPECTING CARD CONTAINERS & LINKS ---');
    $('article, .card, .element, .item, .row-item, li, div').each((i, el) => {
      const links = [];
      $(el).find('a[href]').each((_, a) => {
        links.push({
          href: $(a).attr('href'),
          text: $(a).text().replace(/\s+/g, ' ').trim(),
          class: $(a).attr('class') || ''
        });
      });

      if (links.length >= 2) {
        console.log(`\nContainer ${i} [${el.name}.${$(el).attr('class') || ''}]:`);
        links.forEach((l) => {
          console.log(`  -> href: ${l.href} | class: "${l.class}" | text: "${l.text.slice(0, 40)}"`);
        });
      }
    });
  } catch (err) {
    console.error('Error:', err);
  }
})();
