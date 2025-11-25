import https from "https";

/**
 * Make a request to Cliniko API
 * @param {string} url - Full URL to Cliniko API endpoint
 * @param {object} options - Request options (method, headers, data)
 * @returns {Promise} - Response data
 */
export default async function clinikoAxios(url, options = {}) {
  const { method = "GET", headers = {}, data } = options;

  console.log("[clinikoAxios] making request", {
    url,
    method,
    hasAuthHeader: !!headers.Authorization,
    authHeaderLength: headers.Authorization ? headers.Authorization.length : 0,
    hasData: !!data,
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        "User-Agent": "MediScribeAI Backend",
        Accept: "application/json",
        ...headers,
      },
    };

    console.log("[clinikoAxios] request options", {
      hostname: requestOptions.hostname,
      path: requestOptions.path,
      method: requestOptions.method,
      headersKeys: Object.keys(requestOptions.headers),
    });

    const req = https.request(requestOptions, (res) => {
      let responseData = "";

      console.log("[clinikoAxios] response received", {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: res.headers,
      });

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        console.log("[clinikoAxios] response complete", {
          statusCode: res.statusCode,
          responseLength: responseData.length,
          responsePreview: responseData.substring(0, 200),
        });

        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log("[clinikoAxios] success", {
              statusCode: res.statusCode,
              dataKeys: parsed ? Object.keys(parsed) : null,
              businessesCount: parsed?.businesses?.length || 0,
            });
            resolve({ data: parsed, status: res.statusCode });
          } else {
            console.error("[clinikoAxios] API error", {
              statusCode: res.statusCode,
              error: parsed.message || responseData,
              fullResponse: parsed,
            });
            reject(new Error(`Cliniko API error: ${res.statusCode} - ${parsed.message || responseData}`));
          }
        } catch (e) {
          console.error("[clinikoAxios] JSON parse error", {
            error: e.message,
            responseData: responseData.substring(0, 500),
          });
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: responseData, status: res.statusCode });
          } else {
            reject(new Error(`Cliniko API error: ${res.statusCode} - ${responseData}`));
          }
        }
      });
    });

    req.on("error", (error) => {
      console.error("[clinikoAxios] request error", {
        error: error.message,
        code: error.code,
        stack: error.stack,
      });
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

