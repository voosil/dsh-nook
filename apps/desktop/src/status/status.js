const params = new URLSearchParams(location.search)
if (params.get('state') === 'error') {
  document.querySelector('h1').textContent = 'Nook 暂时无法打开'
  document.querySelector('#message').textContent = params.get('message') || '请重试，或从窗口菜单重新启动本地服务。'
  document.querySelector('#retry').hidden = false
}
