const express = require("express");
const { error } = require("node:console");
const http = require("node:http");
const https = require("node:https");

/** Number of times to do a request retry when forwarded request fails.*/
const request_retries = 3;
/** Flag to capture error response and send as is to the client or do retries and send response back.*/
const do_retry = false;
/**Host where the proxy will be running.*/
const host = "127.0.0.1";
/** Default port for the proxy */
const default_port = 3128;

/**Express app */
const app = express();
// disable powered by header
app.disable("x-powered-by");
//Body Parsers middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());
// for file datas
// app.use(express.raw({type: [""], limit: "100mb"}));

// helper functions

/**
 * A retry backoff algoritm for retries, takes in the current retry count sets a timeout.
 * An simple exponential backoff is used.
 *
 * This backoff is used only when do_retry is set to true. @see {do_retry}
 *
 * **Note: This can make the request timout if retries are too many. Adjust the timeout in the request config if needed.**
 * @param {Number} i Current retry count.
 */
function backoff(i) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.pow(2, i) * 1000);
  });
}

/**
 * Does HTTP/HTTPS request and returns a promise.
 * @param {{}} config Config object for the request.
 * @param {Buffer|String|{}} data Data to be sent in the request.
 * @param {Number} retries Number of retries to be done if request fails defualts to request_retries variable, @see{@link {request_retries}}.
 * @returns {Promise.<{status: Number|undefined,status_message:String|undefined,headers:http.IncomingHttpHeaders,body:any}>} resolve with  response or rejects with error.
 */
const request = (config, data = null, retries = request_retries) => {
  // eslint-disable-next-line no-unused-vars
  return new Promise((resolve, reject) => {
    try {
      // get the protocol agent
      const _agent = config.protocol === "https" ? https : http;

      delete config.protocol;

      let _data = [];
      // for (let i = 0; i < retries; i++) {
      const req = _agent.request(config, (res) => {
        // collect the data
        res.on("data", (chunk) => {
          _data.push(chunk);
        });

        // on end of request
        res.on("end", async () => {
          let _body;

          try {
            if (res.headers["content-type"]?.includes("application/json")) {
              _body = JSON.parse(Buffer.concat(_data).toString("utf-8"));
            }
            //parse html for content type text/html
            else if (res.headers["content-type"]?.includes("text/html")) {
              _body = Buffer.concat(_data).toString("utf-8");
            } else {
              // check if header has encoding and use that to decode the buffer.
              _body = Buffer.concat(_data).toString(res.headers["content-encoding"] ?? "utf-8");
            }
          } catch (err) {
            _body = Buffer.concat(_data).toString();
          }

          const response = {
            status: res.statusCode,
            status_message: res.statusMessage,
            headers: res.headers,
            body: _body,
          };

          // check the condition for resolving the promise.
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
            // } else if (do_retry) {
            //   console.warn(`[${new Date().toISOString()}][PROXY] ${config.method} request to ${config.hostname ?? config.host + config.path} failed with status ${res.statusCode}.\nretrying...`);
            //call backoff and retry the request.
            // await backoff(i);
            // } else if (i === retries - 1) {
            //   resolve(response);
          } else {
            resolve(response);
          }
        });

        // timeout handler
        res.on("timeout", () => {
          reject(new Error(`Request to ${config.hostname ?? config.host + config.path} timed out.`));
        });

        // on error
        res.on("error", (err) => {
          reject(err);
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      // send the data depending on the type of data.
      if (data && data instanceof Buffer) {
        req.write(data, (error) => {
          if (error) {
            reject(error);
          }
        });
      } else if (data && typeof data === "string") {
        req.write(data, "utf-8", (error) => {
          if (error) {
            reject(error);
          }
        });
      } else if (data && typeof data === "object") {
        req.write(JSON.stringify(data), "utf-8", (error) => {
          if (error) {
            reject(error);
          }
        });
      }
      // close the request
      req.end();

    } catch (err) {
      reject(err);
    }
  });
};

// gets the port from cmd args if present.
let _usrDefinedPort = undefined;
// get the index for --port or -p args
const port_arg_index = process.argv.findIndex((arg) => arg === "--port" || arg === "-p");
// if port arg is present and the next arg is a number use that as port.
if (port_arg_index > -1 && !isNaN(process.argv[port_arg_index + 1])) {
  _usrDefinedPort = parseInt(process.argv[port_arg_index + 1]);
  console.log(`[${new Date().toISOString()}][PROXY] Using port ${_usrDefinedPort}`);
} else {
  console.log(`[${new Date().toISOString()}][PROXY] Port not specified using default port ${default_port}`);
}

const port = _usrDefinedPort || default_port;

// A proxy middleware
const proxyMiddleware = (req, res) => {
  try {
    // Get the target URL from the request
    // if targetUrl is empty return 404 with message to specify the target url;
    if (!req.originalUrl || req.originalUrl === "/") {
      console.error(`[PROXY] Target URL not specified in request`);
      return res.status(404).json({ message: "Target URL not specified" });
    }

    const targetUrl = new URL(req?.originalUrl?.replace(/^\//, ""));

    // Make a request to the target URL
    const targetRequest = {
      method: req.method,
      url: targetUrl,
      headers: req.headers,
    };

    // Get the protocol from the target ur
    const protocol = targetRequest.url.protocol.replace(":", "");

    // delete Accept-Encoding header if it is not UTF-8
    // beacause gzip,br, deflate would need external package such as zlib to decode.
    // and trying to keep this as simple as possible 😏.
    if (targetRequest.headers["accept-encoding"] && !targetRequest.headers["accept-encoding"].includes("utf-8")) {
      delete targetRequest.headers["accept-encoding"];
      targetRequest.headers["accept-encoding"] = "utf-8";
    } else {
      targetRequest.headers["accept-encoding"] = "utf-8";
    }

    // change host to target host
    targetRequest.headers.host = targetRequest.url.host;

    // check if charset is present and modify that to utf-8, also if not present then add it.
    // this only for content-type header with `application/json` or `text/html` or `text/plain` or `application/xml`
    if (
      (targetRequest.headers["content-type"] && targetRequest.headers["content-type"]?.includes("application/json")) ||
      targetRequest.headers["content-type"]?.includes("text/html") ||
      targetRequest.headers["content-type"]?.includes("text/plain") ||
      targetRequest.headers["content-type"]?.includes("application/xml")
    ) {
      if (targetRequest.headers["content-type"]?.includes("charset")) {
        targetRequest.headers["content-type"] = targetRequest.headers["content-type"].replace(/charset=[\w-]+/g, "charset=utf-8");
      } else {
        targetRequest.headers["content-type"] += "; charset=utf-8";
      }
    }

    // add via headers
    // targetRequest.headers.Via = `1.1 ${host}:${port} (Mock Proxy)`;

    // create request config
    const config = {
      protocol: protocol,
      hostname: targetRequest.url.hostname,
      port: parseInt(targetRequest.url?.port ?? (protocol === "https" ? "443" : "8000")),
      path: targetRequest.url.pathname + targetRequest.url.search,
      method: targetRequest.method,
      headers: targetRequest.headers,
      // timeout to be added defaults to infinite sec.
      timeout: targetRequest?.timeout || 0,
      // this is to override the certificate validation for https calls.
      // not suitbale to use in production or in any other environment where security is a concern.
      // rejectUnauthorized: false,
      // max redirects to be followed.
      maxRedirects: 20,
    };

    // Make the request to the target URL
    request(config, req.body)
      .then((response) => {
        console.log(`[${new Date().toISOString()}][PROXY] ${config.method} request to ${config.hostname ?? config.host}${config.port ? ":" + config.port : ""} completed with status ${response.status}|${response.status_message}.`);
        res.set(response.headers);
        res.status(response.status).json(response.body);
        return;
      })
      .catch((err) => {
        res.status(500).json({ message: `Internal proxy server error::${err.message ?? "Error message not available"}`, innder_error: err.stack || "UNAVAILABLE" });
        return;
      });
    return;
  } catch (err) {
    res.status(500).json({ message: `Internal proxy server error::${err.message ?? "Error message not available"}` });
    console.error(`[${new Date().toISOString()}][PROXY] PROXY_MIDDLEWARE_ERROR-${err.message}.\nSTACKTRACE: ${err.stack}`);
    return;
  }
};

// Add the proxy middleware function to the app
app.use(proxyMiddleware);

// Error handleing
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log the error
  console.error(err.stack);

  // Check for ECONNRESET or ECONNREFUSED errors
  if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED") {
    res.status(503).send("Service Unavailable");
  } else {
    // Send an appropriate error response for other errors
    if (err.status) {
      res.status(err.status).send(err.message);
    } else {
      res.status(500).send("An unexpected error occurred.");
    }
  }
});

// Start the app
// start the app in local host with port.
app.listen(port, host, () => {
  console.log(`[${new Date().toISOString()}][PROXY] MOCK Proxy running at http://${host}:${port}/`);
});

// handle ctrl+c and exit gracefully.
process.on("SIGINT", function onSigint() {
  console.info(`[${new Date().toISOString()}][PROXY] Closing...`);
  process.exit(130);
});

// handle kill and exit gracefully.
process.on("SIGTERM", function onSigterm() {
  console.info(`[${new Date().toISOString()}][PROXY] Kill signal received...Teriminating...`);
  process.exit(143);
});

// handle break keys and exit.
process.on("SIGBREAK", function onSigbreak() {
  console.info(`[${new Date().toISOString()}][PROXY] Closing...`);
  process.exit(130);
});

process.on("uncaughtException", function onUncaughtException(err) {
  console.error(`[${new Date().toISOString()}][PROXY] Uncaught exception: ${err.message}\nSTACKTRACE: ${err.stack}`);
  process.exit(1);
});

// handle exit and exit
process.on("exit", function onExit() {
  console.info(`[${new Date().toISOString()}][PROXY] Closed!!!`);
});
