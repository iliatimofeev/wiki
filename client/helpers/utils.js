function getHash (url) {
  return url.substring(url.indexOf('#') + 1);
};

export { 
  getHash
}
