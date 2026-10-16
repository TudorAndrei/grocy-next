<?php

// The filtering configuration is from Grocy 4.5.0 BaseApiController.
// See LICENSE.grocy and ../_vendor/htmlpurifier/ORIGIN.json.
error_reporting(E_ALL & ~E_DEPRECATED);

function reply(array $value): void
{
    fwrite(STDOUT, json_encode($value, JSON_THROW_ON_ERROR) . "\n");
    fflush(STDOUT);
}

try {
    if (PHP_VERSION_ID < 80100 || PHP_VERSION_ID >= 80500) {
        throw new RuntimeException('The pinned HTMLPurifier requires PHP 8.1 through 8.4');
    }
    foreach (['bcmath', 'ctype', 'dom', 'fileinfo', 'gd', 'iconv', 'intl', 'libxml', 'mbstring', 'pdo_sqlite', 'simplexml'] as $extension) {
        if (!extension_loaded($extension)) {
            throw new RuntimeException('The PHP extension ' . $extension . ' is required');
        }
    }
    require __DIR__ . '/../_vendor/htmlpurifier/library/HTMLPurifier.auto.php';
    require __DIR__ . '/request_runtime.php';
    require __DIR__ . '/generic_runtime.php';
    require __DIR__ . '/list_runtime.php';
    require __DIR__ . '/action_runtime.php';
    define('GROCY_DATAPATH', $argv[3] ?? $argv[1]);
    if (!is_dir(GROCY_DATAPATH)) {
        mkdir(GROCY_DATAPATH, 0700, true);
    }
    define('GROCY_MODE', 'production');
    define('GROCY_USER_ID', (int)($argv[2] ?? 1));
    if (!is_dir(GROCY_DATAPATH . '/viewcache')) {
        mkdir(GROCY_DATAPATH . '/viewcache', 0700, true);
    }
    $nativeSchema = nativeSchema();
    $config = HTMLPurifier_Config::createDefault();
    $config->set('Cache.SerializerPath', $argv[1]);
    $config->set('HTML.Allowed', 'div,b,strong,i,em,u,a[href|title|target],iframe[src|width|height|frameborder],ul,ol,li,p[style],br,span[style],img[style|width|height|alt|src],table[border|width|style],tbody,tr,td,th,blockquote,*[style|class|id],h1,h2,h3,h4,h5,h6');
    $config->set('Attr.EnableID', true);
    $config->set('HTML.SafeIframe', true);
    $config->set('CSS.AllowedProperties', 'font,font-size,font-weight,font-style,font-family,text-decoration,padding-left,color,background-color,text-align,width,height');
    $config->set('URI.AllowedSchemes', ['data' => true, 'http' => true, 'https' => true]);
    $config->set('URI.SafeIframeRegexp', '%^.*%');
    $config->set('CSS.MaxImgLength', null);
    $purifier = new HTMLPurifier($config);
    reply(['ready' => true, 'version' => HTMLPurifier::VERSION, 'php_version' => PHP_VERSION]);
} catch (Throwable $error) {
    reply(['ready' => false, 'error' => $error->getMessage()]);
    exit(1);
}

while (($line = fgets(STDIN)) !== false) {
    $id = null;
    try {
        $request = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
        $id = $request['id'];
        if (($request['operation'] ?? 'purify') === 'sqlite_function') {
            try {
                $value = nativeSqliteFunction($request['name'], $request['arguments']);
                $body = ['value' => nativeEncodeValue($value)];
            } catch (Throwable $error) {
                $body = ['error' => $error->getMessage(), 'error_kind' => $error instanceof Error ? 'error' : 'exception'];
            }
            reply(['id' => $id, 'ok' => true, 'body' => $body]);
            continue;
        }
        if (in_array($request['operation'] ?? 'purify', ['generic', 'field_write', 'field_read', 'generic_read', 'list_read', 'action'], true)) {
            reply(['id' => $id, 'ok' => true, 'body' => nativeDatabaseRequest($request, $nativeSchema)]);
            continue;
        }
        $raw = base64_decode($request['json'], true);
        $body = filteredBody(parsedBody($raw, 'POST', 'application/json'), $purifier);
        if (substr(ltrim($raw), 0, 1) === '{' && is_array($body)) {
            $body = (object)$body;
        }
        reply(['id' => $id, 'ok' => true, 'body' => $body]);
    } catch (Throwable $error) {
        fwrite(STDERR, 'Input purification failed: ' . get_class($error) . "\n");
        reply(['id' => $id, 'ok' => false]);
    }
}
