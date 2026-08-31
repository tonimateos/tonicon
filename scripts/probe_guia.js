const cheerio = require('cheerio');

(async () => {
  try {
    const res = await fetch('https://guia.barcelona.cat/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML Length:', html.length);

    const $ = cheerio.load(html);
    console.log('Title:', $('title').text().trim());

    console.log('\n--- BUTTONS AND LINKS WITH "VEURE" OR "MÉS" OR "ACTIVITAT" ---');
    $('a, button, div, span').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      const lower = text.toLowerCase();
      if (lower.includes('veure') || lower.includes('més') || lower.includes('activitat')) {
        const href = $(el).attr('href');
        const onclick = $(el).attr('onclick');
        if (href || onclick) {
          console.log(`[${el.name}] "${text.slice(0, 60)}" | href: ${href} | onclick: ${onclick}`);
        }
      }
    });

    console.log('\n--- FORM ACTIONS AND INPUTS ---');
    $('form').each((_, f) => {
      console.log('Form Action:', $(f).attr('action'), 'Method:', $(f).attr('method'));
    });

    console.log('\n--- SCRIPT SRC TAGS ---');
    $('script[src]').each((_, s) => {
      console.log('Script:', $(s).attr('src'));
    });

    // Search HTML text for endpoints
    const apiMatches = html.match(/\/api\/[a-zA-Z0-9_\-\/]+/g) || [];
    console.log('\nAPI Matches:', Array.from(new Set(apiMatches)));

    const bcnMatches = html.match(/https?:\/\/[a-zA-Z0-9_\-\.]+\.barcelona\.cat[^\s"'<>]*/g) || [];
    console.log('\nBCN Domain URLs:', Array.from(new Set(bcnMatches)).slice(0, 20));

    // Test fetching "Vegeu més activitats" link: https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona
    const mevaBcnUrl = 'https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona';
    console.log(`\n--- FETCHING "VEGEU MÉS ACTIVITATS" URL: ${mevaBcnUrl} ---`);
    const mevaRes = await fetch(mevaBcnUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const mevaHtml = await mevaRes.text();
    const $m = cheerio.load(mevaHtml);
    console.log('Meva Bcn Title:', $m('title').text().trim());

    const allDiscoveredLinks = new Set();
    const agendaPages = [
      'https://guia.barcelona.cat/',
      'https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona'
    ];

    // Check for other agenda categories
    $m('a[href]').each((_, a) => {
      const href = $m(a).attr('href');
      if (href) {
        try {
          const abs = new URL(href, 'https://guia.barcelona.cat/').href;
          if (abs.includes('/agenda-recomenada/') || abs.includes('/agenda/')) {
            agendaPages.push(abs);
          }
        } catch {}
      }
    });

    const uniqueAgendas = Array.from(new Set(agendaPages));
    console.log(`\nFound ${uniqueAgendas.length} agenda section pages to crawl:`);
    uniqueAgendas.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

    for (const pageUrl of uniqueAgendas) {
      try {
        const pRes = await fetch(pageUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        const pHtml = await pRes.text();
        const $p = cheerio.load(pHtml);
        $p('a[href]').each((_, a) => {
          const href = $p(a).attr('href');
          if (href && (href.includes('/detall/') || href.includes('code='))) {
            try {
              const absDetail = new URL(href, pageUrl).href.split('#')[0];
              allDiscoveredLinks.add(absDetail);
            } catch {}
          }
        });
      } catch (e) {}
    }

    console.log(`\n🎉 TOTAL DISCOVERED DETAIL EVENT SUBLINKS: ${allDiscoveredLinks.size}`);
    Array.from(allDiscoveredLinks).slice(0, 30).forEach((link, i) => console.log(`  ${i + 1}. ${link}`));

  } catch (err) {
    console.error('Error:', err);
  }
})();
