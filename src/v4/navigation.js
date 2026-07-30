(() => {
  const messageType = "v4:navigate";
  const pageReadyType = "v4:page-ready";
  const interactiveSelector =
    'input, textarea, select, button, [contenteditable="true"], [role="button"], [role="slider"]';

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(interactiveSelector));
  }

  function standaloneLink(direction) {
    const label = direction === "previous" ? "上一頁" : "下一頁";
    return [...document.querySelectorAll(".page-links a")].find((link) =>
      link.textContent.trim().includes(label),
    );
  }

  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    const direction =
      event.key === "ArrowLeft"
        ? "previous"
        : event.key === "ArrowRight"
          ? "next"
          : null;
    if (!direction) return;

    if (window.parent !== window) {
      event.preventDefault();
      window.parent.postMessage({ type: messageType, direction }, "*");
      return;
    }

    const link = standaloneLink(direction);
    if (link) {
      event.preventDefault();
      window.location.href = link.href;
    }
  });

  if (window.parent !== window) {
    window.parent.postMessage(
      {
        type: pageReadyType,
        page: window.location.pathname.split("/").pop(),
      },
      "*",
    );
  }
})();
