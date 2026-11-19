(function () {
  try {
    var saved = localStorage.getItem('pdfword-theme');
    var theme = saved === 'dark' || saved === 'light' ? saved : 'light';
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0F0F10' : '#F7F6F3');
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
