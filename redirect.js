(() => {
  const params = new URLSearchParams(location.search);
  const q = params.get("ca") || params.get("wallet") || params.get("q") || "";
  const chain = params.get("chain") || "";
  const next = new URLSearchParams();
  if (q) next.set("q", q);
  if (q && chain) next.set("chain", chain);
  location.replace(`./analyze.html${next.toString() ? `?${next}` : ""}`);
})();
