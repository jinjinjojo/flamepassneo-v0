const uuid = import('uuid').v4;

export default () => uuid().replace(/-/g, '');
