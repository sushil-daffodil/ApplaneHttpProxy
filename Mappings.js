var Mappings = function () {

}

Mappings.prototype.setMappings= function(mappings){
    this.MAPPINGS = mappings;
}

Mappings.prototype.clearMappings= function(){
    delete this.MAPPINGS;
}

Mappings.prototype.getMappings= function(mappings){
    return this.MAPPINGS;
}

module.exports = Mappings;
