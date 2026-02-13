const DEFAULT_LOGIN_REDIRECT = '/login';

function normalizeRoles(input) {
    const list = Array.isArray(input) ? input : [input];
    return list
        .map((role) =>
            String(role || '')
                .trim()
                .toLowerCase(),
        )
        .filter(Boolean);
}

function isApiRequest(req) {
    return (
        req.xhr ||
        (req.headers.accept &&
            req.headers.accept.includes('application/json')) ||
        (req.headers['content-type'] &&
            req.headers['content-type'].includes('application/json')) ||
        req.originalUrl?.startsWith('/api')
    );
}

export default function requireRole(roles, opts = {}) {
    const allowedRoles = normalizeRoles(roles);
    const redirectTo = opts.redirectTo || DEFAULT_LOGIN_REDIRECT;

    if (allowedRoles.length === 0) {
        throw new Error('requireRole: at least one role is required');
    }

    return (req, res, next) => {
        const role = String(req.session?.user?.role || '')
            .trim()
            .toLowerCase();
        const isAllowed = allowedRoles.includes(role);

        if (isAllowed) {
            return next();
        }

        if (isApiRequest(req)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        return res.redirect(redirectTo);
    };
}
