import React from 'react';
import { PlusCircle, Home, Building, MapPin, CheckCircle, Trash2, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AddressSelectionList = ({
    addresses = [],
    selectedAddressId,
    onSelect,
    onUseCurrentLocation,
    onAddNewAddress,
    onDelete,
    loading = false
}) => {
    return (
        <div className="space-y-4">
            {/* Actions */}
            <div className="space-y-3">
                <button
                    onClick={onUseCurrentLocation}
                    className="w-full flex items-center text-left p-4 bg-card rounded-xl border border-border hover:bg-accent transition-colors shadow-sm group"
                >
                    <div className="bg-primary/10 p-2 rounded-full mr-4 group-hover:bg-primary/20 transition-colors">
                        <LocateFixed className="text-primary h-5 w-5" />
                    </div>
                    <div>
                        <p className="font-bold text-sm text-foreground">Use current location</p>
                        <p className="text-xs text-muted-foreground">Using GPS</p>
                    </div>
                </button>

                <button
                    onClick={onAddNewAddress}
                    className="w-full flex items-center text-left p-4 bg-card rounded-xl border border-border hover:bg-accent transition-colors shadow-sm group"
                >
                    <div className="bg-primary/10 p-2 rounded-full mr-4 group-hover:bg-primary/20 transition-colors">
                        <PlusCircle className="text-primary h-5 w-5" />
                    </div>
                    <div>
                        <p className="font-bold text-sm text-foreground">Add a new address</p>
                        <p className="text-xs text-muted-foreground">Pin your location on the map</p>
                    </div>
                </button>
            </div>

            {/* Saved Addresses Header */}
            <div className="mt-6 mb-2">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Saved Addresses</h3>
            </div>

            {/* Address List */}
            <div className="space-y-3">
                {loading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                ) : addresses && addresses.length > 0 ? (
                    addresses.map((addr) => (
                        <div
                            key={addr.id}
                            onClick={() => onSelect(addr)}
                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all bg-card relative group ${selectedAddressId === addr.id
                                ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.2)]'
                                : 'border-transparent shadow-sm hover:border-primary/30'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`mt-1 p-2 rounded-full flex-shrink-0 ${addr.label?.toLowerCase() === 'home' ? 'bg-blue-100 text-blue-600' :
                                    addr.label?.toLowerCase() === 'work' ? 'bg-purple-100 text-purple-600' :
                                        'bg-gray-100 text-gray-600'
                                    }`}>
                                    {addr.label?.toLowerCase() === 'home' ? <Home size={16} /> :
                                        addr.label?.toLowerCase() === 'work' ? <Building size={16} /> :
                                            <MapPin size={16} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <p className="font-bold text-sm truncate">{addr.label || 'Other'}</p>
                                        {selectedAddressId === addr.id && <CheckCircle className="text-primary h-4 w-4 flex-shrink-0 ml-2" />}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{addr.full}</p>
                                    <p className="text-xs text-muted-foreground mt-1 font-medium">Ph: {addr.phone}</p>
                                </div>
                            </div>

                            {/* Delete Button - Only show if onDelete provided */}
                            {onDelete && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(addr.id);
                                    }}
                                    className="absolute top-2 right-2 p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))
                ) : (
                    <div className="text-center py-8 text-muted-foreground bg-card rounded-xl border border-dashed border-border">
                        <p className="text-sm">No saved addresses found.</p>
                        <p className="text-xs mt-1">Add a new address to continue.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AddressSelectionList;
