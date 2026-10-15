# Set up Google sign-in for SMAT

SMAT now has a **Profile** page with Google sign-in. It uses Google Identity Services in the browser. The OAuth client ID is intentionally blank until you create a client for your website.

## 1. Create a Google web client

1. Open the [Google Cloud Console OAuth Clients page](https://console.cloud.google.com/auth/clients) and select or create a Cloud project.
2. Configure the [Google Auth Platform branding and audience](https://console.cloud.google.com/auth/branding). Choose an app name such as **SMAT** and an appropriate support email. For an external app in testing mode, add the Google accounts that should be able to test it.
3. Create an OAuth client with application type **Web application**.
4. Under **Authorized JavaScript origins**, add the exact origin where SMAT is hosted, for example `https://smat-octave-lab.pages.dev` (scheme and hostname only; no path). For local testing, add `http://localhost:8080` and, if used, `http://127.0.0.1:8080`.
5. The sign-in page only requests basic OpenID profile details (`openid`, `email`, `profile`); it does not ask for Drive, Gmail, or other Google data scopes.

Google's official guide: [Set up a Google API client ID](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## 2. Add the client ID to SMAT

Open `google-auth-config.js` and put the **Client ID** between the quotes:

```js
window.SMAT_GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

The Client ID is designed to be public in a browser app. **Do not add a Client Secret** to this file or to any static website code. If the OAuth client has not authorized the page's exact origin, Google sign-in will not complete.

For Cloudflare Pages Direct Upload, edit the file in the extracted site folder and upload a newly zipped site. For local use, restart/refresh SMAT after saving the file.

## What sign-in does—and does not do

After Google sign-in, SMAT shows the account name, email, and profile photo on its Profile page. It keeps the profile in memory for the current tab and does not save the Google ID token, call Google APIs, or create a server account. Signing in does **not** make scripts private or synchronize them. Script files are saved locally by the browser; browser quick-reopen copies do not sync. This static profile feature is for displaying the signed-in profile, not for authorization or protecting data. A production login that gates access needs a backend to verify Google ID tokens and create secure sessions; Google recommends server-side token verification for backend authentication: [Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Google's button/credential flow is described in [Display the Sign in with Google button](https://developers.google.com/identity/gsi/web/guides/display-button).
