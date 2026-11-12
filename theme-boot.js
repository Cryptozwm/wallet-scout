(() => {
  let theme = "dark";
  try { theme = localStorage.getItem("wallet-investigator-theme") === "light" ? "light" : "dark"; } catch {  }
  document.documentElement.dataset.theme = theme;
})();
