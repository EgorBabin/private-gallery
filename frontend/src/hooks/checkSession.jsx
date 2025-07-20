export async function checkSession() {
    const res = await fetch('http://localhost:3000/api/check-session', {
        credentials: 'include'
    });
    return res.json();
}
