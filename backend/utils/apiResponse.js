function buildPayload(base, extra = {}) {
    return { ...base, ...extra };
}

export function sendSuccess(
    res,
    { httpStatus = 200, status = 'success', message = 'OK', payload = {} } = {},
) {
    return res
        .status(httpStatus)
        .json(buildPayload({ status, message }, payload));
}

export function sendError(
    res,
    {
        httpStatus = 500,
        status = 'error',
        message = 'Internal error',
        payload = {},
    } = {},
) {
    const errorMessage =
        typeof payload.error === 'string' && payload.error.trim()
            ? payload.error
            : message;

    return res
        .status(httpStatus)
        .json(buildPayload({ status, message, error: errorMessage }, payload));
}
