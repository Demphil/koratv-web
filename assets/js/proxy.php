<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Content-Type: text/html; charset=utf-8');

if (isset($_GET['url'])) {
    $url = urldecode($_GET['url']);
    $ch = curl_init();
    
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0');
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    
    curl_close($ch);
    
    if ($httpCode === 200) {
        echo $response;
    } else {
        http_response_code($httpCode);
        echo "Error fetching URL: HTTP $httpCode";
    }
} else {
    http_response_code(400);
    echo "Missing URL parameter";
}
?>
