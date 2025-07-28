# How to generate SSL certificate

1. Open your terminal (I use Git Bash).

2. Run this command:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365
```

3.  When prompted, fill in the fields. **Important:**
    At the question
    `Common Name (e.g. server FQDN or YOUR name) []:`
    type exactly:
    `localhost`

4.  After the certificate and key are generated, copy the files `cert.pem` and `key.pem` to the `SSL` folder inside the project.

That's it!
