document.getElementById('copy-command').addEventListener('click', async () => {
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(document.getElementById('clone-command').textContent.trim());
    status.textContent = 'Commands copied.';
  } catch {
    status.textContent = 'Select and copy the commands above.';
  }
});
