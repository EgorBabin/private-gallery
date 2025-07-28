export async function checkSession() {
    const res = await fetch('/api/check-session', {
        credentials: 'include'
    });
    return res.json();
}
