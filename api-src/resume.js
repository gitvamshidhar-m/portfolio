module.exports = function handler(req, res) {
  const HOME = 'https://vamshidharm.vercel.app';
  const resume = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Vamshidhar Reddy M",
    headline: "Performance Marketer & AI Tool Builder",
    jobTitle: "Performance Marketer & AI Tool Builder",
    url: HOME + '/',
    image: HOME + '/og.png',
    email: "geovamshidhar@gmail.com",
    telephone: "+91-7981719085",
    address: { "@type": "PostalAddress", addressLocality: "Hyderabad", addressCountry: "IN" },
    sameAs: [
      "https://linkedin.com/in/vamshidharreddym",
      "https://github.com/gitvamshidhar-m",
      HOME + '/'
    ],
    summary: "Performance marketer who builds the tools he recommends. 10+ years across SEO, Google Ads / PPC, paid media and CRO, plus three AI SaaS products designed, built and shipped solo.",
    openToWork: true,
    highlights: {
      costPerLeadReduction: "Rs.1,100 to Rs.770 (-30%)",
      roas: "3.2x to 5.5x",
      organicTrafficGrowth: "15%",
      qualifiedLeadsPerMonth: "70+",
      monthlyAdBudget: "Rs.2L+",
      liveProducts: 3
    },
    skills: {
      paidMediaPPC: "95%",
      seoContent: "93%",
      aiAutomation: "90%",
      analytics: "88%",
      development: "78%",
      tools: ["GA4", "Looker Studio", "Tableau", "SEMrush", "Ahrefs", "Search Console", "Screaming Frog", "Google Ads", "LinkedIn Ads", "Meta Ads"]
    },
    liveProducts: [
      { name: "Hook AI", type: "Marketing copy engine", url: "https://hook-ai-marketing-engine.vercel.app" },
      { name: "Creative Predictor", version: "v13.0", type: "AI ad & CRO suite", url: "https://mvamshi56-creative-predictor.static.hf.space/index.html" },
      { name: "AI Growth Strategy Generator", type: "Budget-optimized planning wizard", url: "https://strategy-generator-kwdf-beta.vercel.app" }
    ],
    experience: [
      { role: "Digital Marketing Specialist", company: "Autozilla Software Solutions", start: "May 2023", current: true, achievements: ["Grew organic traffic 15%", "70+ qualified leads/mo", "Rs.2L+ ad spend/mo", "CPL Rs.1,100 -> Rs.770, ROAS 3.2x -> 5.5x"] },
      { role: "Campaign Specialist", company: "Pranathi Software Services", start: "Jun 2022", end: "May 2023" },
      { role: "Digital Marketing Executive", company: "FAMA Technologies", start: "Feb 2021", end: "May 2022" },
      { role: "Digital Marketing Executive", company: "E-Rad Imaging", start: "Jun 2019", end: "Sep 2020" },
      { role: "SEO & SMO Expert", company: "Promantra Synergies", start: "Nov 2017", end: "May 2019" },
      { role: "SEO Executive", company: "Digital Way Soft", start: "Jan 2015", end: "Nov 2017" },
      { role: "Software / Junior Test Engineer", company: "Ainslee Software & Corbz Data", start: "May 2007", end: "Sep 2014" }
    ]
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  res.status(200).json(resume);
};