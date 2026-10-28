"""SDD-C21,C23: lossless source transport shared by preparation and answering."""


def compact_units(units):
    """Reset heading inheritance independently for every complete packet."""
    result, heading = [], None
    for unit in units:
        item = {key: value for key, value in unit.items() if key != 'heading'}
        if unit['heading'] != heading:
            item['heading'] = unit['heading']
        heading = unit['heading']
        result.append(item)
    return result
