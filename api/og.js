// Auto-generated Open Graph PNG for every page/post.
// Usage: /api/og?t=<title>&d=<description>
module.exports = async function handler(req, res) {
  try {
    const { ImageResponse } = await import('@vercel/og');
    const url = new URL(req.url || '/', 'http://localhost');
    const rawTitle = (url.searchParams.get('t') || '').slice(0, 96);
    const desc = (url.searchParams.get('d') || '').slice(0, 150);
    const title = rawTitle || 'Vamshidhar Reddy';
    const sub = desc || 'Performance marketer who builds AI tools.';

    const png = new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            justifyContent: 'center', padding: '62px 72px', position: 'relative',
            background: 'linear-gradient(135deg,#0b0a18 0%,#181136 55%,#10282a 100%)',
          },
          children: [
            {
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '46px' },
                children: [
                  { type: 'div', props: { style: { width: '58px', height: '58px', borderRadius: '16px', background: 'linear-gradient(135deg,#8b7bff,#2ff3c0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '34px', fontWeight: '900' }, children: 'V' } },
                  { type: 'div', props: { style: { fontSize: '34px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.5px' }, children: 'vamshidharm' } },
                ],
              },
            },
            { type: 'div', props: { style: { fontSize: '64px', fontWeight: '900', color: '#ffffff', lineHeight: 1.08, letterSpacing: '-1.5px', marginBottom: '22px', maxWidth: '940px' }, children: title } },
            { type: 'div', props: { style: { fontSize: '30px', color: '#34f5c4', fontWeight: '600', lineHeight: 1.35, maxWidth: '940px' }, children: sub } },
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute', bottom: '38px', left: '72px', right: '72px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '22px',
                  fontSize: '22px', color: '#a9a9c0',
                },
                children: [
                  { type: 'span', props: { children: 'vamshidharm.vercel.app' } },
                  { type: 'span', props: { children: 'Performance Marketing \u00d7 AI' } },
                ],
              },
            },
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