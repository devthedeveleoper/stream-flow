export interface Env {
	ENVIRONMENT?: string;
}

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin',
	'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
	'Access-Control-Max-Age': '86400',
};

function handleOptions(request: Request) {
	if (
		request.headers.get('Origin') !== null &&
		request.headers.get('Access-Control-Request-Method') !== null &&
		request.headers.get('Access-Control-Request-Headers') !== null
	) {
		// Handle CORS preflight requests
		return new Response(null, {
			headers: corsHeaders,
		});
	} else {
		// Handle standard OPTIONS request
		return new Response(null, {
			headers: {
				Allow: 'GET, HEAD, POST, OPTIONS',
			},
		});
	}
}

async function handleMetadata(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const videoUrl = url.searchParams.get('url');

	if (!videoUrl) {
		return Response.json({ error: 'Missing url parameter' }, { status: 400, headers: corsHeaders });
	}

	try {
		const parsedVideoUrl = new URL(videoUrl);
		if (parsedVideoUrl.protocol !== 'http:' && parsedVideoUrl.protocol !== 'https:') {
			return Response.json({ error: 'Invalid URL protocol' }, { status: 400, headers: corsHeaders });
		}
		
		const hostname = parsedVideoUrl.hostname;
		if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '169.254.169.254' || hostname === '0.0.0.0' || hostname.endsWith('.internal')) {
			return Response.json({ error: 'Access to internal network is forbidden' }, { status: 403, headers: corsHeaders });
		}
	} catch (e) {
		return Response.json({ error: 'Invalid URL parameter' }, { status: 400, headers: corsHeaders });
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000);

		const response = await fetch(videoUrl, {
			method: 'HEAD',
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 StreamFlow/1.0',
			},
			signal: controller.signal
		});
		
		clearTimeout(timeoutId);

		let title = '';
		
		const contentDisposition = response.headers.get('content-disposition');
		if (contentDisposition) {
			const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
			if (filenameMatch && filenameMatch[1]) {
				title = filenameMatch[1].replace(/['"]/g, '');
			}
		}
		
		const parsedUrl = new URL(videoUrl);
		if (!title) {
			const pathname = parsedUrl.pathname;
			const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
			if (lastSegment) {
				title = decodeURIComponent(lastSegment);
			} else {
				title = parsedUrl.hostname;
			}
		}

		const allHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			allHeaders[key] = value;
		});

		return Response.json({ 
			title: title,
			contentType: response.headers.get('content-type'),
			contentLength: response.headers.get('content-length'),
			serverStatus: response.status,
			serverStatusText: response.statusText,
			hostname: parsedUrl.hostname,
			protocol: parsedUrl.protocol,
			pathname: parsedUrl.pathname,
			headers: allHeaders
		}, { headers: corsHeaders });

	} catch (error) {
		try {
			const parsedUrl = new URL(videoUrl);
			const pathname = parsedUrl.pathname;
			const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
			const title = lastSegment ? decodeURIComponent(lastSegment) : parsedUrl.hostname;
			return Response.json({ title: title }, { headers: corsHeaders });
		} catch (e) {
			return Response.json({ error: 'Failed to fetch metadata' }, { status: 500, headers: corsHeaders });
		}
	}
}

async function handleProxy(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const videoUrl = url.searchParams.get('url');

	if (!videoUrl) {
		return Response.json({ error: 'Missing url parameter' }, { status: 400, headers: corsHeaders });
	}

	// Security Check
	try {
		const parsedVideoUrl = new URL(videoUrl);
		if (parsedVideoUrl.protocol !== 'http:' && parsedVideoUrl.protocol !== 'https:') {
			return Response.json({ error: 'Invalid URL protocol' }, { status: 400, headers: corsHeaders });
		}
		
		// SSRF protection (basic check)
		const hostname = parsedVideoUrl.hostname;
		if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '169.254.169.254' || hostname === '0.0.0.0' || hostname.endsWith('.internal')) {
			return Response.json({ error: 'Access to internal network is forbidden' }, { status: 403, headers: corsHeaders });
		}
	} catch (e) {
		return Response.json({ error: 'Invalid URL parameter' }, { status: 400, headers: corsHeaders });
	}

	const range = request.headers.get('range');
	const method = request.method;

	try {
		// Forward specific headers from the client
		const clientHeaders = new Headers(request.headers);
		const headersToForward = new Headers({
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 StreamFlow/1.0',
			'Accept': clientHeaders.get('Accept') || '*/*',
			'Connection': 'keep-alive',
			'Accept-Encoding': 'identity'
		});

		// Pass through caching and range headers to ensure stable streaming
		const passthroughRequestHeaders = ['Range', 'If-Match', 'If-Range', 'If-Modified-Since', 'If-Unmodified-Since'];
		passthroughRequestHeaders.forEach(h => {
			if (clientHeaders.has(h)) headersToForward.set(h, clientHeaders.get(h)!);
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds

		let fetchUrl = videoUrl;
		let response: Response | null = null;
		let redirectCount = 0;

		// Manually follow redirects so that cross-origin redirects don't drop the Range header
		while (redirectCount < 5) {
			response = await fetch(fetchUrl, {
				method: method,
				headers: headersToForward,
				signal: controller.signal,
				redirect: 'manual'
			});

			const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
			if (isRedirect) {
				const location = response.headers.get('Location');
				if (location) {
					fetchUrl = new URL(location, fetchUrl).toString();
					redirectCount++;
					continue;
				}
			}
			break;
		}
		
		clearTimeout(timeoutId);

		if (!response || (!response.ok && response.status !== 206 && response.status !== 304)) {
			return Response.json(
				{ error: `Source responded with ${response?.status || 500}` },
				{ status: 502, headers: corsHeaders }
			);
		}

		// Build response headers
		const responseHeaders = new Headers(corsHeaders);
		
		// Pass through crucial response headers
		const passthroughResponseHeaders = [
			'Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 
			'ETag', 'Last-Modified', 'Cache-Control', 'Expires'
		];
		
		passthroughResponseHeaders.forEach(h => {
			if (response.headers.has(h)) responseHeaders.set(h, response.headers.get(h)!);
		});

		// Fallbacks if origin doesn't provide them
		if (!responseHeaders.has('Content-Type')) {
			responseHeaders.set('Content-Type', 'video/mp4');
		}
		if (!responseHeaders.has('Accept-Ranges')) {
			responseHeaders.set('Accept-Ranges', 'bytes');
		}

		const body = method === 'HEAD' ? null : response.body;

		return new Response(body, {
			status: response.status,
			headers: responseHeaders,
		});
	} catch (error) {
		const isTimeout = error instanceof Error && error.name === 'AbortError';
		return Response.json(
			{
				error: isTimeout ? 'Proxy request timed out' : 'Failed to proxy video',
				details: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: isTimeout ? 504 : 500, headers: corsHeaders }
		);
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}

		const url = new URL(request.url);

		if (request.method === 'GET' || request.method === 'HEAD') {
			switch (url.pathname) {
				case '/health':
					return Response.json(
						{
							status: 'ok',
							timestamp: new Date().toISOString(),
							server: 'StreamFlow on Cloudflare (Native)',
							environment: env.ENVIRONMENT || 'development',
						},
						{ headers: corsHeaders }
					);
				case '/metadata':
					return handleMetadata(request);
				case '/proxy':
					return handleProxy(request);
			}
		}

		return new Response('Not Found', { status: 404, headers: corsHeaders });
	},
} satisfies ExportedHandler<Env>;
