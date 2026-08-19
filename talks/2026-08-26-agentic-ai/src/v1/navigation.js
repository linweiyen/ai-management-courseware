(function(){
  var embedded=window.self!==window.top;
  document.body.classList.toggle('embedded',embedded);
  function fitHeadings(){
    document.querySelectorAll('.talk-head h1,.talk-head h2').forEach(function(heading){
      heading.style.fontSize='';
      var size=parseFloat(getComputedStyle(heading).fontSize), min=20;
      while(heading.scrollWidth>heading.clientWidth&&size>min){
        size=Math.max(min,size*.94);
        heading.style.fontSize=size+'px';
      }
    });
  }
  fitHeadings();
  window.addEventListener('resize',fitHeadings);
  var footer=document.querySelector('.talk-footer');
  if(footer){fetch('../manifest.json').then(function(r){return r.json()}).then(function(manifest){var id=location.pathname.split('/').pop().replace(/\.html$/,'');var page=manifest.pages.find(function(item){return item.id===id});var counter=footer.querySelector('span:not(.page-links)');if(page&&counter)counter.textContent=page.index+' / '+manifest.pages.length}).catch(function(){})}
  var links=footer?[].slice.call(footer.querySelectorAll('.page-links a')):[];
  var previous=links.find(function(a){return a.textContent.includes('上一頁')});
  var next=links.find(function(a){return a.textContent.includes('下一頁')||a.textContent.includes('來源')});
  function go(direction){
    if(embedded){window.parent.postMessage({type:'talk:navigate',direction:direction},'*');return}
    var target=direction==='previous'?previous:next;if(target)window.location.href=target.href;
  }
  document.addEventListener('keydown',function(event){
    if(event.defaultPrevented||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(event.target instanceof Element&&event.target.closest('input,textarea,select,button,a,[contenteditable="true"]'))return;
    if(event.key==='ArrowLeft'){event.preventDefault();go('previous')}
    if(event.key==='ArrowRight'||event.key===' '){event.preventDefault();go('next')}
  });
  if(embedded)window.parent.postMessage({type:'talk:page-ready',page:location.pathname.split('/').pop()},'*');
})();
