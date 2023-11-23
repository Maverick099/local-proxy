# local-proxy
Proxy to test CAP app locally if using the sap-cloud-sdk and on-premise destination.

> [!CAUTION]
> Currently facing an `408|Timeout` error on `POST` calls
> 
> Posted on [stackoverflow](https://stackoverflow.com/questions/77479879/post-call-using-https-request-returns-40) and also issue raised on [Node/Help](https://github.com/nodejs/help/issues/4296) repo.
>
> Help is most appreciated here. 


### run proxy:
`npm start`

here the port is 8080.
or

`node proxy.js --port XXXX`

if port is not spcified it defaults to port 3128.

### run with trace

`npm run start-proxy-with-http-trace`
where http and https modules are set to be traced with file location/naming convention as proxy_trace-${pid}-${rotation}.log


### How to use:

Wherever/whichever file you have `VCAP_SERVICES` env variable for your running the CAP applicaiton locally change the `onpremise_proxy_host`, `onpremise_proxy_http_port` and `onpremise_proxy_port` under `VCAP_SERIVCES.connectivity[n].credentials`

eg:

``` json
{
	"VCAP_SERVICES": {
		"connectivity": [
			{
				"label": "connectivity",
				"provider": null,
				"plan": "lite",
				"name": "xxxx-connectivity-service",
				"tags": [
					"connectivity",
					"conn",
					"connsvc"
				],
				"instance_guid": "xxx-xxxxx-xxxx-xxxxx",
				"instance_name": "xxxx_xxxx-connectivity-service",
				"binding_guid": "xxxx-xxxx-xxxx-xxxxxx",
				"binding_name": null,
				"credentials": {
					"tenantmode": "dedicated",
					"clientid": "12345679",
					"token_service_domain": "xxxx.xxx.domain.com",
					"credential-type": "binding-secret",
					"token_service_url": "https://xsd.sxxxx.hana.ondemand.com",
					"xsappname": "whats_in_a_name",
					"onpremise_proxy_ldap_port": "20001",
					"onpremise_socks5_proxy_port": "20004",
					"clientsecret": "whats_a_secret",
					"onpremise_proxy_http_port": "3128",             // change this
					"url": "https://vvv.vvv.xxxx.hana.ondemand.com",
					"onpremise_proxy_host": "127.0.0.1",             // change this
					"uaadomain": "xxxx.x.x.hana.ondemand.com",
					"onpremise_proxy_port": "3128",                  // change this.
					"verificationkey": ""
					}
				}
			]
		}
	}
```


