// Auto-generated Open Graph PNG for every page/post + shareable "first-30-days" plan cards.
// Usage: /api/og?t=<title>&d=<description>  OR  /api/og?p=plan&co=<company>&l1=..&l5=..
module.exports = async function handler(req, res) {
  try {
    const { ImageResponse } = await import('@vercel/og');
    const url = new URL(req.url || '/', 'http://localhost');
    const isPlan = url.searchParams.get('p') === 'plan';
    const rawTitle = (url.searchParams.get('t') || '').slice(0, 96);
    const desc = (url.searchParams.get('d') || '').slice(0, 150);
    const title = rawTitle || 'Vamshidhar Reddy';
    const sub = desc || 'Performance marketer who builds AI tools.';

    if (isPlan) {
      const co = (url.searchParams.get('co') || 'Your company').slice(0, 40);
      const lines = [];
      for (let i = 1; i <= 6; i++) {
        const l = url.searchParams.get('l' + i);
        if (l) lines.push(String(l).slice(0, 96));
      }
      const png = new ImageResponse(
        {
          type: 'div',
          props: {
            style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '56px 64px', background: 'linear-gradient(135deg,#0b0a18 0%,#181136 55%,#10282a 100%)', position: 'relative' },
            children: [
              { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '34px' }, children: [{ type: 'div', props: { style: { fontSize: '30px', fontWeight: '800', color: '#8b7bff' }, children: 'FIRST 30 DAYS AT ' + co } }, { type: 'div', props: { style: { width: '46px', height: '46px', borderRadius: '12px', background: 'linear-gradient(135deg,#8b7bff,#2ff3c0)', color: '#fff', fontSize: '26px', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: 'V' } }] } },
              { type: 'div', props: { style: { color: '#fff', fontSize: '52px', fontWeight: '900', letterSpacing: '-1px', marginBottom: '26px' }, children: 'What I would do in my first 30 days:' } },
              {
                type: 'div',
                props: { style: { display: 'flex', flexDirection: 'column', gap: '16px' }, children: (lines.length ? lines : ['Run a free 30-minute growth audit and agree the KPI.'].concat(['Audit current spend: ad groups, target CPA, CRO backlog.'])).map(function (line) {
                  return { type: 'div', props: { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' }, children: [{ type: 'div', props: { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#2ff3c0', marginTop: '12px' }, children: [] } }, { type: 'div', props: { style: { fontSize: '24px', color: '#e8e8f4', lineHeight: '1.35' }, children: line } }] } };
                }) },
              },
              { type: 'div', props: { style: { position: 'absolute', bottom: '34px', left: '64px', right: '64px', borderTop: '1px solid rgba(255,255,255,.12)', paddingTop: '18px', display: 'flex', justifyContent: 'space-between', fontSize: '18px', color: '#a9a9c0' }, children: ['vamshidharm.vercel.app', 'Vamshidhar Reddy M · performance marketer who builds'] } }
            ],
          },
        },
        { width: 1200, height: 630 }
      );
      const buf1 = Buffer.from(await png.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=604800');
      res.status(200).send(buf1);
      return;
    }

    const png = new ImageResponse(
      {
        type: 'div',
        props: {
          style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '62px 72px', position: 'relative', background: 'linear-gradient(135deg,#0b0a18 0%,#181136 55%,#10282a 100%)' },
          children: [
            { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '46px' }, children: [{ type: 'div', props: { style: { width: '58px', height: '58px', borderRadius: '16px', background: 'linear-gradient(135deg,#8b7bff,#2ff3c0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '34px', fontWeight: '900' }, children: 'V' } }, { type: 'div', props: { style: { fontSize: '34px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.5px' }, children: 'vamshidharm' } }] } },
            { type: 'div', props: { style: { fontSize: '64px', fontWeight: '900', color: '#ffffff', lineHeight: 1.08, letterSpacing: '-1.5px', marginBottom: '22px', maxWidth: '940px' }, children: title } },
            { type: 'div', props: { style: { fontSize: '30px', color: '#34f5c4', fontWeight: '600', lineHeight: 1.35, maxWidth: '940px' }, children: sub } },
            { type: 'div', props: { style: { position: 'absolute', bottom: '38px', left: '72px', right: '72px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '22px', fontSize: '22px', color: '#a9a9c0' }, children: ['vamshidharm.vercel.app', 'Performance Marketing \u00d7 AI'] } }
          ],
        },
      },
      { width: 1200, height: 630 }
    );

    const buf = Buffer.from(await png.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};